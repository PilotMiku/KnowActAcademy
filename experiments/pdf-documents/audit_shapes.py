"""Independently re-render each candidate and compare source glyphs and layout.

OCR confidence alone never produces an approval. Every passing formula must
have matching source contours, symbol count/order, relative type size, and
baseline layout. Rejections remain in the review queue, not silently accepted.
"""
import argparse
import json
from pathlib import Path
import statistics
import subprocess
import time
import re
import itertools
import signal
import hashlib

import fitz
from glyphs import GlyphMatcher, CACHE, ROOT
from source_shapes import flat_tex
from structure_check import check as compare_structure


def descriptors(svg, matcher):
    with fitz.open(stream=svg.encode(), filetype='svg') as document:
        with fitz.open(stream=document.convert_to_pdf(), filetype='pdf') as pdf:
            drawings = pdf[0].get_drawings()
    fills = [d['rect'] for d in drawings if d.get('fill') is not None]
    drawings = [d for d in drawings if not (d['type']=='s' and any(
        max(abs(a-b) for a,b in zip(d['rect'],r))<.003 for r in fills))]
    return [{**matcher.identify(d),'bbox':list(d['rect'])} for d in drawings]


def parse_timeout(signum,frame):
    raise TimeoutError('SVG parsing exceeded 3 seconds')


def compare(source, rendered):
    if len(source) != len(rendered):
        return {'passed':False,'reason':'symbol-count','source':len(source),'rendered':len(rendered)}
    if any(g['glyph'] is None for g in source):
        return {'passed':False,'reason':'unidentified-source-contour'}
    if any(a['glyph'] != b['glyph'] for a,b in zip(source,rendered)):
        return {'passed':False,'reason':'symbol-contour-or-order'}
    se, re = max(g.get('em',0) for g in source),max(g.get('em',0) for g in rendered)
    if not se or not re:
        return {'passed':False,'reason':'no-reference-font-size'}
    sb = statistics.median(g['baseline'] for g in source if g.get('em',0)>.9*se)
    rb = statistics.median(g['baseline'] for g in rendered if g.get('em',0)>.9*re)
    size_error = max(abs(a.get('em',0)/se-b.get('em',0)/re) for a,b in zip(source,rendered))
    baseline_error = max((abs((a['baseline']-sb)/se-(b['baseline']-rb)/re)
                          for a,b in zip(source,rendered) if a.get('em') and b.get('em')),default=0)
    sx0,rx0=min(g['bbox'][0] for g in source),min(g['bbox'][0] for g in rendered)
    sw=max(g['bbox'][2] for g in source)-sx0
    rw=max(g['bbox'][2] for g in rendered)-rx0
    x_error=max(abs((a['bbox'][0]-sx0)/max(sw,.001)-(b['bbox'][0]-rx0)/max(rw,.001))
                for a,b in zip(source,rendered))
    passed=size_error<.035 and baseline_error<.12 and x_error<.055
    return {'passed':passed,'reason':None if passed else 'layout',
            'sizeError':round(size_error,5),'baselineError':round(baseline_error,5),
            'horizontalError':round(x_error,5)}


def variants(text):
    yield text
    normalized=re.sub(r'\\operatorname\s*\{\s*(l\s*n|s\s*i\s*n|c\s*o\s*s|t\s*a\s*n)\s*\}',
                      lambda m:'\\'+re.sub(r'\s','',m[1]),text)
    plain=re.sub(r'\\(?:mathbf|boldsymbol|mathit|mathrm)\s*\{\s*([A-Za-z0-9])\s*\}',r'\1',normalized)
    plain=re.sub(r'\\(?:bf|it|rm)\b','',plain)
    if normalized!=text:yield normalized
    if plain!=normalized:yield plain
    display=r'{\displaystyle '+normalized+'}'
    yield display
    if plain!=normalized:yield r'{\displaystyle '+plain+'}'
    if re.search(r'\\begin\s*\{(?:cases|[pbvVB]?matrix|array|aligned)\}',normalized):
        for spacing in ['0.2em','-0.2em']:
            adjusted=re.sub(r'\\\\(?!\s*\[)',lambda _:r'\\['+spacing+']',normalized)
            yield adjusted
            yield r'{\displaystyle '+adjusted+'}'


def audit(mode='all',limit=None):
    recognized={}
    path=CACHE/'recognition.jsonl'
    if path.exists():
        for line in path.read_text().splitlines():
            row=json.loads(line);recognized[row['id']]=row
    existing={}
    target=CACHE/'formula-audit.jsonl'
    if target.exists():
        for line in target.read_text().splitlines():
            row=json.loads(line)
            if row.get('passed'):
                existing[row['id']]=row
    matcher=GlyphMatcher()
    repaired={}
    if (CACHE/'repaired-candidates.jsonl').exists():
        for line in (CACHE/'repaired-candidates.jsonl').open():
            row=json.loads(line);repaired[row['id']]=row['text']
    attempt_path=CACHE/'audit-attempts.json'
    attempts=json.loads(attempt_path.read_text()) if attempt_path.exists() else {}
    implementation=hashlib.sha256(b''.join(Path(__file__).with_name(name).read_bytes() for name in
        ['audit_shapes.py','glyphs.py','source_shapes.py','structure_check.py'])+
        (CACHE/'verified-glyph-labels.json').read_bytes()+
        ((CACHE/'glyph-equivalences.json').read_bytes() if (CACHE/'glyph-equivalences.json').exists() else b'')).hexdigest()
    process=subprocess.Popen(['node',str(ROOT/'experiments/pdf-documents/mathjax.cjs')],
                             stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
    total=passed=0
    start=time.monotonic()
    signal.signal(signal.SIGALRM,parse_timeout)
    try:
        with target.open('a',encoding='utf-8') as output:
            source_files=[CACHE/'source-glyphs.jsonl']
            if (CACHE/'compound-glyphs.jsonl').exists():source_files.append(CACHE/'compound-glyphs.jsonl')
            with __import__('contextlib').ExitStack() as stack:
                streams=[stack.enter_context(path.open()) for path in source_files]
                for line in itertools.chain.from_iterable(streams):
                    record=json.loads(line)
                    fid=record['id']
                    if fid in existing and existing[fid].get('sourceVersion',0)==record.get('sourceVersion',0):
                        continue
                    if not record['pathCountMatches']:continue
                    candidates=[]
                    if mode in {'all','direct'} and record['pathCountMatches']:
                        direct=flat_tex(record['glyphs'])
                        if direct:candidates.append(('vector-reconstruction',direct))
                    if mode in {'all','ocr'} and fid in recognized and not recognized[fid]['truncated']:
                        candidates.append(('local-formula-ocr',recognized[fid]['text']))
                    if mode=='all' and fid in repaired:
                        candidates.append(('source-symbol-repair',repaired[fid]))
                    if not candidates:
                        continue
                    fingerprint=hashlib.sha256(json.dumps([implementation,record.get('sourceVersion',0),record['glyphs'],candidates],sort_keys=True).encode()).hexdigest()
                    if attempts.get(fid)==fingerprint:continue
                    final={'id':fid,'passed':False,'reason':'no-verified-candidate'}
                    for method,base_text in candidates:
                        for text in variants(base_text):
                            process.stdin.write(json.dumps({'id':fid,'text':text},ensure_ascii=False)+'\n')
                            process.stdin.flush()
                            rendered=json.loads(process.stdout.readline())
                            if rendered.get('error') or not rendered.get('svg'):
                                final={'id':fid,'text':text,'passed':False,'reason':'latex-render-error','method':method}
                                continue
                            try:
                                (CACHE/'audit-current.json').write_text(json.dumps({'id':fid,'text':text}))
                                signal.setitimer(signal.ITIMER_REAL,3)
                                rendered_glyphs=descriptors(rendered['svg'],matcher)
                                comparison=compare(record['glyphs'],rendered_glyphs)
                                if not comparison['passed']:
                                    structural=compare_structure(record['glyphs'],rendered_glyphs)
                                    if structural['passed']:comparison=structural
                            except Exception as error:
                                comparison={'passed':False,'reason':'render-parse-error','error':str(error)}
                            finally:signal.setitimer(signal.ITIMER_REAL,0)
                            final={'id':fid,'text':text,'method':method,**comparison}
                            if final['passed']:break
                            if final.get('reason')=='unidentified-source-contour':break
                        if final['passed']:break
                    final['sourceVersion']=record.get('sourceVersion',0)
                    output.write(json.dumps(final,ensure_ascii=False)+'\n')
                    attempts[fid]=fingerprint
                    total+=1;passed+=bool(final['passed'])
                    if total%500==0:
                        output.flush()
                        print(json.dumps({'checked':total,'passed':passed,'seconds':round(time.monotonic()-start,1)}),flush=True)
                    if limit and total>=limit:
                        break
    finally:
        process.stdin.close();process.wait()
        temporary=attempt_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(attempts));temporary.replace(attempt_path)
    print(json.dumps({'checked':total,'passed':passed,'seconds':round(time.monotonic()-start,1)}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode',choices=['all','direct','ocr'],default='all')
    parser.add_argument('--limit',type=int)
    args=parser.parse_args()
    audit(args.mode,args.limit)
