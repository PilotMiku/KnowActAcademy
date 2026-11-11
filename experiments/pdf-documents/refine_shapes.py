"""Resolve previously unsupported quadrilateral fraction rules from source paths."""
import hashlib
import json
from pathlib import Path
from collections import defaultdict
import fitz
from glyphs import GlyphMatcher,CACHE,ROOT
from source_shapes import flat_tex


def refine():
    extraction=json.loads((CACHE/'extraction.json').read_text())
    sources={d['documentId']:d['source'] for d in extraction['documents']}
    matcher=GlyphMatcher()
    path=CACHE/'source-glyphs.jsonl'
    temporary=path.with_suffix('.refined.jsonl')
    pdf=None;current=None;pages={}
    fixed=0;count=0;direct={};aliases={};signatures={}
    try:
        with path.open() as stream,temporary.open('w',encoding='utf-8') as output:
            for line in stream:
                record=json.loads(line);location=record['location'];did=location['documentId']
                if record['unknownGlyphs']:
                    if current!=did:
                        if pdf:pdf.close()
                        pdf=fitz.open(ROOT/sources[did]['path']);current=did;pages={}
                    pi=location['page']-1
                    if pi not in pages:pages[pi]=pdf[pi].get_drawings()
                    for glyph in record['glyphs']:
                        if glyph['glyph'] is not None:continue
                        matches=[d for d in pages[pi] if max(abs(a-b) for a,b in zip(d['rect'],glyph['bbox']))<.001]
                        for drawing in matches:
                            identified=matcher.identify(drawing)
                            if identified['glyph'] is not None:
                                glyph.update(identified);fixed+=1;break
                    record['unknownGlyphs']=sum(g['glyph'] is None for g in record['glyphs'])
                if record['pathCountMatches'] and not record['unknownGlyphs']:
                    rect=fitz.Rect(location['bbox']);h=max(rect.height,.001)
                    signature=[(g['glyph'],*[round((v-(rect.x0 if n%2==0 else rect.y0))/h,3)
                                             for n,v in enumerate(g['bbox'])]) for g in record['glyphs']]
                    digest=hashlib.sha256(json.dumps(signature).encode()).hexdigest()
                    aliases[record['id']]=signatures.setdefault(digest,record['id'])
                    candidate=flat_tex(record['glyphs'])
                    if candidate:direct[record['id']]=candidate
                output.write(json.dumps(record,ensure_ascii=False)+'\n');count+=1
                if count%1000==0:
                    output.flush();print(json.dumps({'formulas':count,'resolvedRules':fixed,'candidates':len(direct)}),flush=True)
    finally:
        if pdf:pdf.close()
    temporary.replace(path)
    children=CACHE/'compound-glyphs.jsonl'
    if children.exists():
        child_rows=[json.loads(line) for line in children.read_text().splitlines()]
        parents={r['parent'] for r in child_rows}
        updated={}
        for line in path.open():
            parent=json.loads(line)
            if parent['id'] in parents:updated[parent['id']]={tuple(g['bbox']):g for g in parent['glyphs']}
        for row in child_rows:
            row['glyphs']=[updated.get(row['parent'],{}).get(tuple(g['bbox']),g) for g in row['glyphs']]
            row['unknownGlyphs']=sum(g['glyph'] is None for g in row['glyphs'])
        children.write_text(''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in child_rows),encoding='utf-8')
    (CACHE/'formula-aliases.json').write_text(json.dumps(aliases))
    (CACHE/'direct-candidates.json').write_text(json.dumps(direct,ensure_ascii=False))
    print(json.dumps({'formulas':count,'resolvedRules':fixed,'candidates':len(direct),
                      'aliases':len(aliases),'distinctShapes':len(set(aliases.values()))}),flush=True)


if __name__=='__main__':refine()
