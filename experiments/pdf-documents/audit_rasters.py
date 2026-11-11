"""Compare re-rendered LaTeX against raster originals, retaining failed cases.

This is a second, geometric check rather than an OCR confidence threshold.
Component coverage prevents a small missing minus sign from being hidden by a
high whole-image similarity score. It does not certify surrounding Chinese OCR.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess
import time

import cv2
import fitz
import numpy as np
from PIL import Image
from glyphs import ROOT,CACHE
from audit_shapes import variants


def ink(image):
    pixels=np.array(image.convert('L'))
    mask=(pixels<180).astype(np.uint8)
    ys,xs=np.nonzero(mask)
    if not len(xs):raise ValueError('Empty formula raster')
    return mask[ys.min():ys.max()+1,xs.min():xs.max()+1]


def rendered_ink(svg):
    with fitz.open(stream=svg.encode(),filetype='svg') as document:
        with fitz.open(stream=document.convert_to_pdf(),filetype='pdf') as pdf:
            pix=pdf[0].get_pixmap(matrix=fitz.Matrix(16,16),alpha=False)
    return ink(Image.frombytes('RGB',[pix.width,pix.height],pix.samples))


def compare(source,target):
    aspect=(target.shape[1]/target.shape[0])/(source.shape[1]/source.shape[0])
    if not .97<aspect<1.03:return {'passed':False,'reason':'aspect','ratio':round(aspect,4)}
    # Normalize by height; allow only small anti-alias / raster rounding error.
    count,_,stats,_=cv2.connectedComponentsWithStats(source,8)
    heights=[row[cv2.CC_STAT_HEIGHT] for row in stats[1:] if row[cv2.CC_STAT_HEIGHT]>=max(4,source.shape[0]*.02)]
    typical=float(np.median(heights)) if heights else source.shape[0]
    # Keep each matrix entry large enough to distinguish e.g. 2 from 3;
    # shrinking the entire matrix to 128 pixels would erase that evidence.
    height=max(128,min(1536,round(source.shape[0]*64/max(typical,1))))
    a=cv2.resize(source,(max(1,round(source.shape[1]*height/source.shape[0])),height),interpolation=cv2.INTER_NEAREST)
    b=cv2.resize(target,(a.shape[1],height),interpolation=cv2.INTER_NEAREST)
    width=max(a.shape[1],b.shape[1])+8
    aa=np.zeros((height+8,width),np.uint8);bb=aa.copy()
    aa[4:height+4,4:4+a.shape[1]]=a;bb[4:height+4,4:4+b.shape[1]]=b
    best=None
    kernel=np.ones((3,3),np.uint8)
    for dy in [-1,0,1]:
        for dx in [-1,0,1]:
            shifted=np.roll(bb,(dy,dx),(0,1))
            cover_a=cv2.dilate(shifted,kernel);cover_b=cv2.dilate(aa,kernel)
            missing_a=aa*(1-cover_a);missing_b=shifted*(1-cover_b)
            error=float((missing_a.sum()+missing_b.sum())/(aa.sum()+shifted.sum()))
            if best is None or error<best[0]:best=(error,missing_a,missing_b,shifted)
    error,missing_a,missing_b,shifted=best
    worst=0
    for mask,missing in [(aa,missing_a),(shifted,missing_b)]:
        count,labels,stats,_=cv2.connectedComponentsWithStats(mask,8)
        for index in range(1,count):
            if stats[index,cv2.CC_STAT_AREA]<5:continue
            component=labels==index
            worst=max(worst,float(missing[component].sum()/component.sum()))
    passed=error<.025 and worst<.055
    return {'passed':passed,'reason':None if passed else 'raster-shape',
            'symmetricUncoveredInk':round(error,5),'worstComponentUncovered':round(worst,5),
            'aspectRatio':round(aspect,5)}


def main(limit=None,calibrate=False):
    original_proofs={r['id']:r for line in (CACHE/'formula-audit.jsonl').open()
                     if (r:=json.loads(line)).get('passed')}
    seen={};target=CACHE/'raster-audit-v2-screening.jsonl'
    if target.exists():
        for line in target.open():
            row=json.loads(line)
            if row.get('passed'):seen[row['id']]=row
    recognized={r['id']:r for line in (CACHE/'recognition.jsonl').open() if (r:=json.loads(line))}
    if calibrate:candidates=list(original_proofs.items())[:limit or 100]
    else:candidates=[(fid,row) for fid,row in recognized.items() if fid not in seen and not row['truncated']]
    if limit:candidates=candidates[:limit]
    process=subprocess.Popen(['node',str(ROOT/'experiments/pdf-documents/mathjax.cjs')],
                             stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)
    counts=Counter();start=time.monotonic()
    try:
        with target.open('a') as output:
            for index,(fid,row) in enumerate(candidates,1):
                path=CACHE/'refined-crops'/(fid+'.png')
                if not path.exists():path=CACHE/'crops'/(fid+'.png')
                with Image.open(path) as image:source=ink(image)
                final={'id':fid,'passed':False,'reason':'latex-render-error'}
                for text in variants(row['text']):
                    process.stdin.write(json.dumps({'id':fid,'text':text})+'\n');process.stdin.flush()
                    render=json.loads(process.stdout.readline())
                    if render.get('error') or not render.get('svg'):continue
                    try:result=compare(source,rendered_ink(render['svg']))
                    except Exception as error:result={'passed':False,'reason':'raster-parse-error','error':str(error)}
                    final={'id':fid,'text':text,'method':'independent-raster-comparison',
                           'screeningOnly':True,'thresholdVersion':2,**result}
                    if final['passed']:break
                counts['checked']+=1;counts['passed']+=bool(final['passed']);counts[final.get('reason') or 'accepted']+=1
                if not calibrate:output.write(json.dumps(final,ensure_ascii=False)+'\n')
                if index%100==0:
                    output.flush();print(json.dumps({**counts,'seconds':round(time.monotonic()-start,1)}),flush=True)
    finally:process.stdin.close();process.wait()
    print(json.dumps({**counts,'seconds':round(time.monotonic()-start,1)}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--limit',type=int)
    parser.add_argument('--calibrate',action='store_true');args=parser.parse_args()
    main(args.limit,args.calibrate)
