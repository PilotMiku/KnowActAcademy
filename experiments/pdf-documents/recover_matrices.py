"""Recover determinant grids from PDF glyph coordinates, then require an audit."""
import json
import statistics
from assemble import CACHE, Resolver, jsonl
from source_shapes import flat_tex, VERIFIED_LABELS


def candidate(glyphs):
    known=[g['em'] for g in glyphs if g.get('em')]
    if not known:return None
    em=max(known)
    bars=[g for g in glyphs if g.get('latex')=='|' and not g.get('em') and g['bbox'][3]-g['bbox'][1]>2.5*em]
    if len(bars)!=2:return None
    left,right=sorted(bars,key=lambda g:g['bbox'][0])
    if abs(left['bbox'][1]-right['bbox'][1])>em*.2 or abs(left['bbox'][3]-right['bbox'][3])>em*.2:return None
    inner=[g for g in glyphs if left['bbox'][2]<g['bbox'][0] and g['bbox'][2]<right['bbox'][0]]
    if any(not g.get('em') for g in inner):return None
    bases=sorted([g for g in inner if g['em']>em*.88],key=lambda g:g['baseline'])
    baselines=[]
    for g in bases:
        if not baselines or abs(g['baseline']-statistics.mean(baselines[-1]))>.25*em:baselines.append([])
        baselines[-1].append(g['baseline'])
    centers=[statistics.mean(row) for row in baselines]
    if len(centers)<2:return None
    rows=[[] for _ in centers]
    for g in inner:
        index=min(range(len(centers)),key=lambda i:abs(g['baseline']-centers[i]))
        rows[index].append(g)
    texts=[];length=None
    for row in rows:
        ordered=sorted(row,key=lambda g:g['bbox'][0]);cells=[];edge=None
        for g in ordered:
            if edge is None or g['bbox'][0]-edge>.48*em:cells.append([])
            cells[-1].append(g);edge=max(edge or g['bbox'][2],g['bbox'][2])
        if length is None:length=len(cells)
        if len(cells)!=length or length<2:return None
        values=[flat_tex(cell) for cell in cells]
        if not all(values):return None
        texts.append('&'.join(values))
    prefix=[g for g in glyphs if g['bbox'][2]<=left['bbox'][0]]
    suffix=[g for g in glyphs if g['bbox'][0]>=right['bbox'][2]]
    before=flat_tex(prefix) if prefix else '';after=flat_tex(suffix) if suffix else ''
    if before is None or after is None:return None
    return before+r'\begin{vmatrix}'+r'\\'.join(texts)+r'\end{vmatrix}'+after


def main():
    resolver=Resolver();target=CACHE/'repaired-candidates.jsonl';count=0
    with target.open('a') as output:
        for record in jsonl(CACHE/'source-glyphs.jsonl'):
            if resolver.formula(record['id'])['status'] in {'source-contours-checked','manually-reviewed','independent-reading-checked'}:continue
            text=candidate(record['glyphs'])
            if text:
                output.write(json.dumps({'id':record['id'],'text':text,'method':'pdf-glyph-coordinate-grid'})+'\n');count+=1
    print(json.dumps({'determinantCandidates':count}),flush=True)


if __name__=='__main__':main()
