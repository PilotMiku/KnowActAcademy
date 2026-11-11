"""Separate visually empty answer brackets before mathematical OCR.

Only paired bracket contours enclosing no ink qualify. Any substantial material
after the closing bracket prevents the split. The preceding expression remains
a separate OCR task; no algebraic content is inferred from a blank.
"""
import json
import math
from pathlib import Path
import cv2
import fitz
import numpy as np
from PIL import Image
from extract import normalize_crop
from glyphs import ROOT,CACHE

SUP=ROOT/'.cache/supplement-transcription'


def bracket(mask):
    h,w=mask.shape
    if h<12 or not .06<w/h<.48:return None
    xs=[];widths=[]
    for row in mask:
        x=np.flatnonzero(row)
        if not len(x):return None
        xs.append((x[0]+x[-1])/2);widths.append(x[-1]-x[0]+1)
    edge=max(1,round(h*.12));middle=np.array(xs[h//3:h*2//3]);ends=np.array(xs[:edge]+xs[-edge:])
    median_width=float(np.median(widths[h//3:h*2//3]));edge_width=float(np.percentile(widths[:edge]+widths[-edge:],90))
    if edge_width>median_width*1.5:
        if np.median(middle)<w*.35:return '['
        if np.median(middle)>w*.65:return ']'
    delta=float(np.median(ends)-np.median(middle))
    if abs(delta)>w*.25 and median_width<w*.65:
        return '(' if delta>0 else ')'
    return None


def detect(image):
    mask=(np.array(image.convert('L'))<180).astype(np.uint8)
    count,labels,stats,_=cv2.connectedComponentsWithStats(mask,8)
    components=[]
    for i in range(1,count):
        x,y,w,h,area=stats[i]
        if area<5:continue
        kind=bracket(mask[y:y+h,x:x+w])
        if kind:components.append({'kind':kind,'box':[int(x),int(y),int(x+w),int(y+h)]})
    for left in sorted(components,key=lambda c:c['box'][0],reverse=True):
        if left['kind'] not in {'[','('}:continue
        a,b,c,d=left['box'];height=d-b
        for right in components:
            if (left['kind'],right['kind']) not in {('[',']'),('(',')')}:continue
            e,f,g,h=right['box']
            if e-c<height*.5 or abs(b-f)>height*.1 or abs(d-h)>height*.1:continue
            if mask[max(0,min(b,f)):min(mask.shape[0],max(d,h)),c:e].any():continue
            remainder=mask[:,g:]
            ys,xs=np.nonzero(remainder)
            if len(ys) and (ys.max()-ys.min()+1>height*.5 or len(ys)>height*height*.12
                            or xs.max()-xs.min()+1>height*.9):continue
            ys,xs=np.nonzero(mask[:,:a])
            return {'prefixBox':[0,0,a,image.height] if len(xs) else None,'blank':left['kind']+right['kind'],
                    'opening':left['box'],'closing':right['box'],'emptyGapPixels':e-c}
    return None


def main():
    target=SUP/'blank-formulas.json';result=json.loads(target.read_text()) if target.exists() else {}
    ids={n['id'] for line in (SUP/'segments.jsonl').open() for n in json.loads(line)['nodes'] if n['kind']=='formula'}
    new=0
    for fid in sorted(ids-set(result)):
        path=CACHE/'crops'/(fid+'.png')
        with Image.open(path) as image:
            if image.width/image.height<1.15:continue
            evidence=detect(image)
            if not evidence:continue
            child=None
            if evidence['prefixBox']:
                prefix=image.crop(evidence['prefixBox'])
                child,_,png=normalize_crop(prefix.convert('L'),fitz.Rect(evidence['prefixBox']))
                (CACHE/'crops'/(child+'.png')).write_bytes(png)
        result[fid]={'prefixId':child,'suffix':r'[\quad]' if evidence['blank']=='[]' else r'(\quad)',
                     'evidence':evidence,'method':'empty-source-bracket-contours'};new+=1
    temporary=target.with_suffix('.tmp');temporary.write_text(json.dumps(result));temporary.replace(target)
    print(json.dumps({'sourceBlankFormulas':len(result),'newlySeparated':new}))


if __name__=='__main__':main()
