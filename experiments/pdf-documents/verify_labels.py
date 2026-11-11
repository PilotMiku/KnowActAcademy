"""Prove each preferred LaTeX atom renders the intended source font contour."""
import json
import re
import subprocess
from glyphs import ROOT,CACHE,GlyphMatcher
from audit_shapes import descriptors


def priority(tex):
    if len(tex)==1 and tex.isascii():return (0,tex)
    if re.fullmatch(r'\\[A-Za-z]+',tex):return (10+len(tex),tex)
    if len(tex)==1:return (100,tex)
    if tex.startswith('{\\displaystyle'):return (300+len(tex),tex)
    return (150+len(tex),tex)


def main():
    candidates=json.loads((CACHE/'glyph-label-candidates.json').read_text())
    matcher=GlyphMatcher();selected={}
    process=subprocess.Popen(['node',str(ROOT/'experiments/pdf-documents/mathjax.cjs')],
                             stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
    try:
        for number,tex in enumerate(candidates):
            process.stdin.write(json.dumps({'id':number,'text':tex},ensure_ascii=False)+'\n');process.stdin.flush()
            row=json.loads(process.stdout.readline())
            if row.get('error') or not row.get('svg'):continue
            try:glyphs=descriptors(row['svg'],matcher)
            except Exception:continue
            if len(glyphs)!=1 or not isinstance(glyphs[0].get('glyph'),int):continue
            gid=str(glyphs[0]['glyph'])
            if gid not in selected or priority(tex)<priority(selected[gid]):selected[gid]=tex
    finally:
        process.stdin.close();process.wait()
    (CACHE/'verified-glyph-labels.json').write_text(json.dumps(selected,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'candidateAtoms':len(candidates),'verifiedContours':len(selected)}),flush=True)


if __name__=='__main__':main()
