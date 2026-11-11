"""Verify sized delimiter labels against the actual MathJax font contours."""
import json
import subprocess
from glyphs import ROOT,CACHE,GlyphMatcher
from audit_shapes import descriptors


def main():
    target=CACHE/'verified-glyph-labels.json';labels=json.loads(target.read_text());before=len(labels)
    delimiters=['(',')','[',']',r'\{',r'\}',r'\langle',r'\rangle',r'\lfloor',r'\rfloor',
                r'\lceil',r'\rceil',r'\vert',r'\Vert',r'\backslash','/']
    candidates=[size+delimiter for size in [r'\big',r'\Big',r'\bigg',r'\Bigg'] for delimiter in delimiters]
    candidates += [r'\Phi',r'\mathbf{\Phi}',r'\boldsymbol{\Phi}',r'\mathsf{\Phi}',r'\mathit{\Phi}']
    matcher=GlyphMatcher();process=subprocess.Popen(['node',str(ROOT/'experiments/pdf-documents/mathjax.cjs')],
                                                   stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    try:
        for index,text in enumerate(candidates):
            process.stdin.write(json.dumps({'id':index,'text':text})+'\n');process.stdin.flush()
            result=json.loads(process.stdout.readline())
            if result.get('error'):continue
            glyphs=descriptors(result['svg'],matcher)
            if len(glyphs)==1 and isinstance(glyphs[0]['glyph'],int):labels.setdefault(str(glyphs[0]['glyph']),text)
    finally:process.stdin.close();process.wait()
    target.write_text(json.dumps(labels,ensure_ascii=False))
    print(json.dumps({'newVerifiedSizedDelimiters':len(labels)-before,'total':len(labels)}))


if __name__=='__main__':main()
