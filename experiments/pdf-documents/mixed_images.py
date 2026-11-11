"""Segment supplied raster questions into original Chinese text and math crops.

Produces resumable candidates and source coordinates. Recognition is local;
these candidates are not automatically published or marked manually verified.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import time

import cv2
import fitz
import numpy as np
import onnxruntime as ort
from PIL import Image,ImageDraw
from rapidocr import RapidOCR
import re
import os

from extract import normalize_crop
from glyphs import ROOT,CACHE

SUPPLEMENT=ROOT/'.cache/supplement-transcription'
CJK=re.compile(r'[\u3400-\u9fff]')


class Detector:
    def __init__(self,threads=1):
        options=ort.SessionOptions();options.intra_op_num_threads=threads;options.inter_op_num_threads=1
        self.model=ort.InferenceSession(str(CACHE/'models/mfd-1.5/pix2text-mfd-1.5.onnx'),
                                        sess_options=options,providers=['CPUExecutionProvider'])
    def __call__(self,image):
        width,height=image.size
        gain=min(768/width,768/height,2.5)
        w,h=round(width*gain),round(height*gain)
        cw,ch=max(128,math.ceil(w/32)*32),max(128,math.ceil(h/32)*32)
        dx,dy=(cw-w)//2,(ch-h)//2
        resized=image.resize((w,h),Image.Resampling.BILINEAR)
        canvas=Image.new('RGB',(cw,ch),(114,114,114));canvas.paste(resized,(dx,dy))
        pixels=np.asarray(canvas).astype(np.float32).transpose(2,0,1)[None]/255
        pred=self.model.run(None,{'images':pixels})[0][0].T
        scores=pred[:,4:].max(axis=1);classes=pred[:,4:].argmax(axis=1)
        valid=np.flatnonzero(scores>.35)
        xywh=[];kept_scores=[]
        for i in valid:
            cx,cy,bw,bh=pred[i,:4]
            xywh.append([float(cx-bw/2),float(cy-bh/2),float(bw),float(bh)])
            kept_scores.append(float(scores[i]))
        keep=cv2.dnn.NMSBoxes(xywh,kept_scores,.35,.45)
        result=[]
        for k in np.array(keep).reshape(-1):
            x,y,bw,bh=xywh[k]
            box=[max(0,(x-dx)/gain),max(0,(y-dy)/gain),
                 min(width,(x+bw-dx)/gain),min(height,(y+bh-dy)/gain)]
            if box[2]-box[0]>1 and box[3]-box[1]>1:
                result.append({'bbox':box,'detectionConfidence':kept_scores[k],
                               'type':'embedding' if classes[valid[k]]==0 else 'isolated'})
        return result


class Segmenter:
    def __init__(self):
        self.detector=Detector()
        self.text=RapidOCR(params={'EngineConfig.onnxruntime.intra_op_num_threads':1,
                                  'EngineConfig.onnxruntime.inter_op_num_threads':1,
                                  'Global.use_cls':False,'Det.limit_type':'max',
                                  'Det.limit_side_len':960})
    def read_text(self,image,boxes):
        masked=image.copy();draw=ImageDraw.Draw(masked)
        for box in boxes:
            draw.rectangle(tuple(box['bbox']),fill='white')
        gray=np.asarray(masked.convert('L'))
        if np.count_nonzero(gray<180)<5:return []
        scale=min(3,max(1,1600/image.width))
        enlarged=masked.resize((round(masked.width*scale),round(masked.height*scale)),Image.Resampling.LANCZOS)
        output=self.text(np.asarray(enlarged))
        if output.boxes is None:return []
        result=[]
        for box,text,score in zip(output.boxes,output.txts,output.scores):
            coords=box/scale
            result.append({'kind':'text','text':text,'confidence':float(score),
                           'bbox':[float(coords[:,0].min()),float(coords[:,1].min()),
                                   float(coords[:,0].max()),float(coords[:,1].max())]})
        return result
    def __call__(self,path,image_id):
        with Image.open(path) as raw:image=raw.convert('RGB')
        formulas=self.detector(image)
        text=self.read_text(image,formulas)
        # Include punctuation / empty-answer delimiters missed by the formula
        # detector. Their pixel content is re-recognized, not copied from OCR.
        changed=False
        if formulas:
            for item in text:
                if CJK.search(item['text']):continue
                x0,y0,x1,y1=item['bbox'];cy=(y0+y1)/2
                eligible=[]
                for formula in formulas:
                    a,b,c,d=formula['bbox']
                    distance=max(0,a-x1,x0-c)
                    if b-(y1-y0)*.3<=cy<=d+(y1-y0)*.3 and distance<max(8,(y1-y0)*3):
                        eligible.append((distance,formula))
                if eligible:
                    target=min(eligible,key=lambda p:p[0])[1]
                    a,b,c,d=target['bbox'];target['bbox']=[min(a,x0),min(b,y0),max(c,x1),max(d,y1)]
                    changed=True
            if changed:text=self.read_text(image,formulas)
        # An option consisting entirely of mathematical symbols can be below
        # the detector's minimum size; preserve it as a whole-image candidate.
        if not formulas and not any(CJK.search(t['text']) for t in text) and np.count_nonzero(np.asarray(image.convert('L'))<180)>=5:
            formulas=[{'bbox':[0,0,image.width,image.height],'detectionConfidence':None,
                       'type':'whole-math-image'}];text=[]
        nodes=list(text)
        for formula in formulas:
            x0,y0,x1,y1=formula['bbox']
            crop=image.crop((max(0,math.floor(x0)-1),max(0,math.floor(y0)-1),
                             min(image.width,math.ceil(x1)+1),min(image.height,math.ceil(y1)+1)))
            try:
                digest,bounds,png=normalize_crop(crop.convert('L'),fitz.Rect(formula['bbox']))
            except ValueError:
                continue
            destination=CACHE/'crops'/(digest+'.png')
            if not destination.exists():
                temporary=destination.with_suffix('.'+str(os.getpid())+'.tmp')
                temporary.write_bytes(png);temporary.replace(destination)
            nodes.append({'kind':'formula','id':digest,**formula})
        return {'id':image_id,'size':list(image.size),'nodes':nodes,
                'reviewStatus':'machine-candidate','source':str(path.relative_to(ROOT))}


WORKER=None
def prepare_worker():
    global WORKER
    WORKER=Segmenter()

def segment_worker(fid):
    return WORKER(SUPPLEMENT/'images'/(fid+'.png'),fid)

def main(phase='stems',limit=None,workers=2):
    marker=SUPPLEMENT/'segmentation.complete.json'
    if phase=='all' and not limit:marker.unlink(missing_ok=True)
    inventory=json.loads((SUPPLEMENT/'inventory.json').read_text())
    if phase=='stems':
        ids=list(dict.fromkeys(i for q in inventory['questions'] for i in q['rows'][0]['images']))
    elif phase=='original-rasters':
        ids=list(dict.fromkeys(row['imageId'] for row in json.loads((SUPPLEMENT/'original-raster-parts.json').read_text())['parts']))
    else:
        ids=[i['id'] for i in inventory['images'] if not i.get('decodeError')]
        original=SUPPLEMENT/'original-raster-parts.json'
        if original.exists():ids+=list(dict.fromkeys(row['imageId'] for row in json.loads(original.read_text())['parts']))
    output=SUPPLEMENT/'segments.jsonl';seen=set()
    if output.exists():
        seen={json.loads(s)['id'] for s in output.read_text().splitlines()}
    ids=[fid for fid in ids if fid not in seen and (SUPPLEMENT/'images'/(fid+'.png')).exists()]
    if limit:ids=ids[:limit]
    print(json.dumps({'phase':phase,'pending':len(ids),'cached':len(seen)}),flush=True)
    start=time.monotonic()
    with ProcessPoolExecutor(max_workers=workers,initializer=prepare_worker) as executor,output.open('a',encoding='utf-8') as stream:
        for number,record in enumerate(executor.map(segment_worker,ids,chunksize=1),1):
            stream.write(json.dumps(record,ensure_ascii=False)+'\n')
            if number%20==0:
                stream.flush();print(json.dumps({'completed':number,'total':len(ids),
                                                 'seconds':round(time.monotonic()-start,1)}),flush=True)
    print(json.dumps({'completed':len(ids),'seconds':round(time.monotonic()-start,1)}),flush=True)
    if phase=='all' and not limit:
        marker.write_text(json.dumps({'completedImages':len(ids)+len(seen),'source':'inventory.json'}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase',choices=['stems','all','original-rasters'],default='stems')
    parser.add_argument('--limit',type=int)
    parser.add_argument('--workers',type=int,default=2)
    args=parser.parse_args();main(args.phase,args.limit,args.workers)
