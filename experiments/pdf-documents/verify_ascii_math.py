"""Independently read simple raster formulas and check script positions.

The general text recognizer is independent of the formula recognizer. Approval
requires identical printed characters, high confidence from both models, and
consistent baseline/superscript/subscript positions. Stacked fractions, roots,
matrices and non-ASCII symbols abstain rather than being flattened into text.
"""
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
import re
import subprocess
import time
import unicodedata
import xml.etree.ElementTree as ET
import cv2
import numpy as np
from PIL import Image
from rapidocr import RapidOCR
from rapidocr.ch_ppocr_rec.typings import TextRecInput
from glyphs import ROOT,CACHE

OCR=RENDERER=None
ALLOWED=set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789=+-()[]|.,;!<>:/')


def prepare():
    global OCR,RENDERER
    cv2.setNumThreads(1)
    OCR=RapidOCR(params={'EngineConfig.onnxruntime.intra_op_num_threads':1,
                         'EngineConfig.onnxruntime.inter_op_num_threads':1,'Global.use_cls':False})
    RENDERER=subprocess.Popen(['node',str(ROOT/'experiments/pdf-documents/mathjax.cjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)


def flatten(node,role=0):
    name=node.tag.rsplit('}',1)[-1]
    if name in {'mi','mn','mo','mtext'}:
        text=unicodedata.normalize('NFKC',node.text or '').replace('−','-').replace('\u2061','')
        text=re.sub(r'\s+','',text)
        if any(char not in ALLOWED for char in text):raise ValueError('Unsupported symbol')
        return [(char,role) for char in text]
    if name in {'math','mrow','mstyle'}:return [value for child in node for value in flatten(child,role)]
    if name=='mspace':return []
    if name in {'msup','msub','msubsup'} and role==0:
        children=list(node);result=flatten(children[0],0)
        result+=flatten(children[1],1 if name=='msup' else -1)
        if name=='msubsup':result+=flatten(children[2],1)
        return result
    raise ValueError('Unsupported layout')


def verify(job):
    fid,row=job;result={'id':fid,'passed':False,'method':'independent-character-reading-and-script-geometry'}
    if row['truncated'] or row['confidence']<.985 or row['minimumTokenConfidence']<.85:return result
    RENDERER.stdin.write(json.dumps({'id':fid,'text':row['text'],'mathml':True})+'\n');RENDERER.stdin.flush()
    rendered=json.loads(RENDERER.stdout.readline())
    try:expected=flatten(ET.fromstring(rendered['mathml']))
    except (KeyError,ET.ParseError,ValueError):return result
    if not expected:return result
    with Image.open(CACHE/'crops'/(fid+'.png')) as raw:
        image=raw.convert('RGB');mask=np.array(image.convert('L'))<180
        ys,xs=np.nonzero(mask)
        if not len(xs):return result
        image=image.crop((max(0,int(xs.min())-2),max(0,int(ys.min())-2),min(image.width,int(xs.max())+3),min(image.height,int(ys.max())+3)))
    output=OCR.text_rec(TextRecInput(img=np.array(image),return_word_box=True))
    text=unicodedata.normalize('NFKC',output.txts[0]).replace('−','-');text=re.sub(r'\s+','',text)
    if text!=''.join(char for char,role in expected) or output.scores[0]<.97:return result
    info=output.word_results[0]
    if not info.line_txt_len or not info.confs or min(info.confs)<.8:return result
    positions=[column for word,columns in zip(info.words,info.word_cols) for char,column in zip(word,columns) if not char.isspace()]
    if len(positions)!=len(expected):return result
    centers=[(column+.5)*image.width/info.line_txt_len for column in positions]
    mask=(np.array(image.convert('L'))<180).astype(np.uint8)
    n,_,stats,_=cv2.connectedComponentsWithStats(mask,8)
    typical=[r[cv2.CC_STAT_HEIGHT] for r in stats[1:] if r[cv2.CC_STAT_HEIGHT]>3]
    if not typical:return result
    if any(r[cv2.CC_STAT_WIDTH]>np.median(typical)*6 for r in stats[1:]):return result
    boxes=[]
    for i,cx in enumerate(centers):
        left=0 if i==0 else math_floor((centers[i-1]+cx)/2)
        right=image.width if i==len(centers)-1 else math_ceil((cx+centers[i+1])/2)
        ys,xs=np.nonzero(mask[:,max(0,left):min(image.width,right)])
        if not len(ys):return result
        boxes.append((int(ys.min()),int(ys.max())))
    anchors=[i for i,(char,role) in enumerate(expected) if role==0 and char.isalnum() and char not in 'fgjpqy']
    if not anchors:return result
    baseline=max(boxes[i][1] for i in anchors);height=float(np.median([boxes[i][1]-boxes[i][0]+1 for i in anchors]))
    for i,(char,role) in enumerate(expected):
        top,bottom=boxes[i]
        if i in anchors and abs(bottom-baseline)>height*.3:return result
        if role==1 and bottom>baseline-height*.18:return result
        if role==-1 and bottom<baseline+height*.05:return result
    return {**result,'passed':True,'text':row['text'],'textRecognizerConfidence':float(output.scores[0]),
            'minimumCharacterConfidence':float(min(info.confs)),'charactersChecked':len(expected),
            'scriptsChecked':sum(role!=0 for char,role in expected)}


def math_floor(x):return int(np.floor(x))
def math_ceil(x):return int(np.ceil(x))


def main():
    directory=ROOT/'.cache/supplement-transcription';ids=set()
    for name in ['segments.jsonl','segments-overrides.jsonl','segments-reading-order-v2.jsonl']:
        path=directory/name
        if path.exists():
            for line in path.open():ids.update(n['id'] for n in json.loads(line)['nodes'] if n['kind']=='formula')
    blanks=json.loads((directory/'blank-formulas.json').read_text());ids-=set(blanks)
    ids.update(r['prefixId'] for r in blanks.values() if r['prefixId'])
    recognized={r['id']:r for line in (CACHE/'recognition.jsonl').open() if (r:=json.loads(line))}
    target=CACHE/'independent-math-verification.jsonl';seen=set()
    if target.exists():seen={json.loads(line)['id'] for line in target.open()}
    jobs=[(fid,recognized[fid]) for fid in sorted(ids&set(recognized)-seen) if not recognized[fid]['truncated']
          and recognized[fid]['confidence']>=.985 and recognized[fid]['minimumTokenConfidence']>=.85
          and not re.search(r'\\(?:[dtc]?frac|sqrt|root|begin|int|sum|prod|over|under|hat|vec|dot|lim)',recognized[fid]['text'])]
    start=time.monotonic();passed=0
    print(json.dumps({'pending':len(jobs)}),flush=True)
    with ProcessPoolExecutor(max_workers=4,initializer=prepare) as pool,target.open('a') as stream:
        for i,row in enumerate(pool.map(verify,jobs,chunksize=1),1):
            stream.write(json.dumps(row,ensure_ascii=False)+'\n');passed+=bool(row['passed'])
            if i%200==0:
                stream.flush();print(json.dumps({'checked':i,'total':len(jobs),'passed':passed,'seconds':round(time.monotonic()-start,1)}),flush=True)
    print(json.dumps({'checked':len(jobs),'passed':passed,'seconds':round(time.monotonic()-start,1)}),flush=True)


if __name__=='__main__':main()
