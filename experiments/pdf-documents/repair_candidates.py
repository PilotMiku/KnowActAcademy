"""Repair OCR leaf symbols using the actual PDF vector glyph identities.

The OCR supplies a structural candidate only. Source contours supply leaf
characters. Repairs are still rejected unless a separate full re-render audit
matches every original symbol and its layout.
"""
from collections import Counter
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET

from glyphs import ROOT,CACHE
from source_shapes import flat_tex,VERIFIED_LABELS

LEAF={'mi','mn','mo','mtext','ms'}
NS='http://www.w3.org/1998/Math/MathML'


def tag(node):return node.tag.rsplit('}',1)[-1]


def literal(text):
    mapping={'−':'-','≤':r'\leq','≥':r'\geq','≠':r'\ne','∞':r'\infty','∈':r'\in',
             '∉':r'\notin','⊂':r'\subset','⊆':r'\subseteq','∪':r'\cup','∩':r'\cap',
             '∅':r'\varnothing','→':r'\to','⇒':r'\Rightarrow','⇔':r'\Leftrightarrow',
             '∫':r'\int','∑':r'\sum','∏':r'\prod','∂':r'\partial','∇':r'\nabla',
             '⋯':r'\cdots','…':r'\ldots','⋮':r'\vdots','⋱':r'\ddots','·':r'\cdot',
             '×':r'\times','±':r'\pm','∓':r'\mp','′':r'\prime','″':r'\prime\prime',
             '{':r'\{','}':r'\}','%':r'\%','&':r'\&','#':r'\#','_':r'\_'}
    return ' '.join(mapping.get(c,c) for c in text)


def serialize(node,replacements):
    kind=tag(node);children=list(node)
    if kind in LEAF:
        value=replacements.get(id(node),literal(node.text or ''))
        # Preserve automatic delimiter sizing from the structural candidate.
        if kind=='mo' and node.text and node.get('stretchy')!='false' and not re.search(r'\\(?:big|Big)',value):
            if node.text in '([{':value=r'\left'+value
            elif node.text in ')]}':value=r'\right'+value
        return value
    values=[serialize(child,replacements) for child in children]
    if kind in {'math','mrow','TeXAtom','semantics'}:
        value=' '.join(values)
        difference=value.count(r'\left')-value.count(r'\right')
        if difference>0:value+=r'\right.'*difference
        return value
    if kind=='mstyle':
        value=' '.join(values)
        return (r'{\displaystyle '+value+'}') if node.get('displaystyle')=='true' else value
    if kind=='mfrac':return r'\frac{'+values[0]+'}{'+values[1]+'}'
    if kind=='msqrt':return r'\sqrt{'+ ' '.join(values)+'}'
    if kind=='mroot':return r'\sqrt['+values[1]+']{'+values[0]+'}'
    if kind=='msup':return '{'+values[0]+'}^{'+values[1]+'}'
    if kind=='msub':return '{'+values[0]+'}_{'+values[1]+'}'
    if kind=='msubsup':return '{'+values[0]+'}_{'+values[1]+'}^{'+values[2]+'}'
    if kind=='munder':return r'\mathop{'+values[0]+r'}\limits_{'+values[1]+'}'
    if kind=='munderover':return r'\mathop{'+values[0]+r'}\limits_{'+values[1]+'}^{'+values[2]+'}'
    if kind=='mover':
        mark=''.join(children[1].itertext()).strip()
        if mark in {'→','⃗'}:return r'\vec{'+values[0]+'}'
        if mark in {'¯','―','‾','‾'}:return r'\overline{'+values[0]+'}'
        if mark in {'^','ˆ','̂'}:return r'\hat{'+values[0]+'}'
        return r'\overset{'+values[1]+'}{'+values[0]+'}'
    if kind=='mspace':return r'\quad' if node.get('width') in {'1em','1.000em'} else ''
    if kind in {'mpadded','mphantom'}:return ' '.join(values) if kind=='mpadded' else r'\phantom{'+ ' '.join(values)+'}'
    if kind=='mtable':
        columns=max((len(row) for row in children),default=1)
        align=node.get('columnalign','center').split()
        spec=''.join({'left':'l','right':'r','center':'c'}.get(align[min(i,len(align)-1)],'c') for i in range(columns))
        return r'\begin{array}{'+spec+'}'+r'\\'.join(values)+r'\end{array}'
    if kind in {'mtr','mlabeledtr'}:return '&'.join(values)
    if kind=='mtd':return ' '.join(values)
    if kind in {'annotation','annotation-xml'}:return ''
    raise ValueError('Unsupported structural node '+kind)


def repair(record,response):
    svg=ET.fromstring(response['svg']);math=ET.fromstring(response['mathml'])
    shapes=[node for node in svg.iter() if tag(node) in {'path','rect'}]
    glyphs=record['glyphs']
    if len(shapes)!=len(glyphs) or any(g['glyph'] is None for g in glyphs):return None
    order={id(node):index for index,node in enumerate(shapes)}
    groups=[node for node in svg.iter() if node.get('data-mml-node') in LEAF]
    leaves=[node for node in math.iter() if tag(node) in LEAF]
    if len(groups)!=len(leaves):return None
    replacements={};changed=0
    for group,leaf in zip(groups,leaves):
        if group.get('data-mml-node')!=tag(leaf):return None
        selected=[glyphs[order[id(node)]] for node in group.iter() if id(node) in order]
        if not selected:continue
        replacement=flat_tex(selected)
        if not replacement and len(selected)==1:
            replacement=VERIFIED_LABELS.get(str(selected[0]['glyph']),selected[0].get('latex'))
        if replacement:
            replacements[id(leaf)]=replacement;changed+=1
    if not changed:return None
    result=serialize(math,replacements)
    if re.search(r'(?<!\\)[\u3400-\u9fff]',result):return None
    return result


def main():
    recognized={r['id']:r for line in (CACHE/'recognition.jsonl').open() if (r:=json.loads(line))}
    approved={r['id'] for line in (CACHE/'formula-audit.jsonl').open() if (r:=json.loads(line)).get('passed')}
    sources=[CACHE/'source-glyphs.jsonl',CACHE/'compound-glyphs.jsonl']
    process=subprocess.Popen(['node',str(ROOT/'experiments/pdf-documents/mathjax.cjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
    counts=Counter();start=time.monotonic()
    try:
        with (CACHE/'repaired-candidates.jsonl').open('w') as stream:
            for source in sources:
                if not source.exists():continue
                for line in source.open():
                    row=json.loads(line);fid=row['id'];ocr=recognized.get(fid)
                    if fid in approved or not ocr or ocr['truncated'] or row['unknownGlyphs']:continue
                    process.stdin.write(json.dumps({'id':fid,'text':ocr['text'],'includeMathML':True})+'\n');process.stdin.flush()
                    response=json.loads(process.stdout.readline());counts['considered']+=1
                    if response.get('error') or not response.get('mathml'):continue
                    try:text=repair(row,response)
                    except (ValueError,ET.ParseError,IndexError):text=None
                    if text:
                        counts['repairedCandidates']+=1
                        stream.write(json.dumps({'id':fid,'text':text,'method':'source-contour-leaves-in-structural-candidate'},ensure_ascii=False)+'\n')
                    if counts['considered']%500==0:
                        stream.flush();print(json.dumps({**counts,'seconds':round(time.monotonic()-start,1)}),flush=True)
    finally:process.stdin.close();process.wait()
    print(json.dumps({**counts,'seconds':round(time.monotonic()-start,1)}),flush=True)


if __name__=='__main__':main()
