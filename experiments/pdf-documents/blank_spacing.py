"""Measure actual delimiter side bearings before restoring empty answer gaps."""
import json
import re
import subprocess
from glyphs import CACHE,ROOT,GlyphMatcher
from audit_shapes import descriptors


def main():
    labels=json.loads((CACHE/'verified-glyph-labels.json').read_text());pairs={}
    for line in (CACHE/'source-glyphs.jsonl').open():
        row=json.loads(line)
        for left,right in zip(row['glyphs'],row['glyphs'][1:]):
            a,b=labels.get(str(left['glyph'])),labels.get(str(right['glyph']))
            if not a or not b:continue
            aa=re.sub(r'\\(?:big|Big|bigg|Bigg)', '', a)
            bb=re.sub(r'\\(?:big|Big|bigg|Bigg)', '', b)
            if (aa,bb) in {('(',')'),('[',']'),(r'\{',r'\}')}:pairs[(left['glyph'],right['glyph'])]=(a,b)
    matcher=GlyphMatcher();result={}
    process=subprocess.Popen(['node',str(ROOT/'experiments/pdf-documents/mathjax.cjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    try:
        for (left,right),(a,b) in pairs.items():
            process.stdin.write(json.dumps({'id':'pair','text':a+' '+b})+'\n');process.stdin.flush();render=json.loads(process.stdout.readline())
            if render.get('error'):continue
            glyphs=descriptors(render['svg'],matcher)
            if len(glyphs)!=2 or [g['glyph'] for g in glyphs]!=[left,right]:continue
            em=max(g.get('em',0) for g in glyphs)
            if em:result[str(left)+':'+str(right)]=(glyphs[1]['bbox'][0]-glyphs[0]['bbox'][2])/em
    finally:process.stdin.close();process.wait()
    (CACHE/'delimiter-spacing.json').write_text(json.dumps(result))
    print(json.dumps({'verifiedDelimiterPairSpacings':len(result)}))


if __name__=='__main__':main()
