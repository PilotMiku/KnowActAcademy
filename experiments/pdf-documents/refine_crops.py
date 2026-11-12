"""Preserve high-resolution source crops and split provably separate equation rows.

A row split is allowed only across blank source ink AND between complete source
glyphs. A matrix/case brace or a fraction crossing a cut prevents that split.
"""
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import statistics
import fitz
import numpy as np
from PIL import Image
from extract import normalize_crop, local_source_path
from glyphs import CACHE,ROOT


def main():
    approved=set()
    for line in (CACHE/'formula-audit.jsonl').read_text().splitlines():
        record=json.loads(line)
        if record.get('passed'):approved.add(record['id'])
    data=json.loads((CACHE/'extraction.json').read_text())
    sources={d['documentId']:d['source'] for d in data['documents']}
    target=CACHE/'refined-crops';target.mkdir(exist_ok=True)
    compounds={};pdf=None;current=None;pages={};count=0;child_count=0
    with (CACHE/'source-glyphs.jsonl').open() as stream,(CACHE/'compound-glyphs.jsonl').open('w',encoding='utf-8') as child_stream:
        try:
            for line in stream:
                record=json.loads(line);fid=record['id']
                if fid in approved:continue
                location=record['location'];bounds=fitz.Rect(location['bbox'])
                if bounds.height<19:continue
                did=location['documentId'];pi=location['page']-1
                if did!=current:
                    if pdf:pdf.close()
                    pdf=fitz.open(local_source_path(ROOT,sources[did]['path']));current=did;pages={}
                if pi not in pages:
                    pix=pdf[pi].get_pixmap(matrix=fitz.Matrix(4,4),colorspace=fitz.csGRAY)
                    pages[pi]=Image.frombytes('L',(pix.width,pix.height),pix.samples)
                box=tuple(round(v*4) for v in bounds)
                bitmap=pages[pi].crop(box).point(lambda p:p if p<180 else 255)
                _,_,png=normalize_crop(bitmap,bounds)
                (target/(fid+'.png')).write_bytes(png);count+=1
                known=[g.get('em',0) for g in record['glyphs'] if g.get('em')]
                if not known or bounds.width<180 or bounds.height<max(known)*2.5:continue
                em=max(known);ink=np.asarray(bitmap)<180
                blank=np.flatnonzero(~ink.any(axis=1))
                runs=[]
                for row in blank:
                    if runs and row==runs[-1][-1]+1:runs[-1].append(int(row))
                    else:runs.append([int(row)])
                cuts=[]
                for run in runs:
                    if len(run)<em*4*.23:continue
                    y=bounds.y0+(run[0]+run[-1])/8
                    if not bounds.y0+em*.5<y<bounds.y1-em*.5:continue
                    if any(g['bbox'][1]+.1<y<g['bbox'][3]-.1 for g in record['glyphs']):continue
                    cuts.append(y)
                if not cuts:continue
                edges=[bounds.y0]+cuts+[bounds.y1];regions=[];valid=True
                for top,bottom in zip(edges,edges[1:]):
                    glyphs=[g for g in record['glyphs'] if top<=(g['bbox'][1]+g['bbox'][3])/2<=bottom]
                    if not glyphs:valid=False;break
                    width=max(g['bbox'][2] for g in glyphs)-min(g['bbox'][0] for g in glyphs)
                    if width<bounds.width*.18:valid=False;break
                    regions.append((top,bottom,glyphs))
                if not valid or len(regions)<2:continue
                ids=[]
                for number,(top,bottom,glyphs) in enumerate(regions):
                    child=hashlib.sha256((fid+':source-row:'+str(number)).encode()).hexdigest()[:24]
                    region=fitz.Rect(bounds.x0,top,bounds.x1,bottom)
                    image=pages[pi].crop(tuple(round(v*4) for v in region)).point(lambda p:p if p<180 else 255)
                    _,_,png=normalize_crop(image,region)
                    (CACHE/'crops'/(child+'.png')).write_bytes(png)
                    child_record={'id':child,'glyphs':glyphs,
                                  'pathCountMatches':record['pathCountMatches'],
                                  'unknownGlyphs':sum(g['glyph'] is None for g in glyphs),
                                  'parent':fid,'location':{**location,'bbox':list(region)}}
                    child_stream.write(json.dumps(child_record,ensure_ascii=False)+'\n')
                    child_count+=1;ids.append(child)
                compounds[fid]=ids
                if count%500==0:print(json.dumps({'refined':count,'compoundFormulas':len(compounds),'rows':child_count}),flush=True)
        finally:
            if pdf:pdf.close()
    (CACHE/'compound-formulas.json').write_text(json.dumps(compounds),encoding='utf-8')
    print(json.dumps({'refined':count,'compoundFormulas':len(compounds),'rows':child_count}),flush=True)


if __name__=='__main__':main()
