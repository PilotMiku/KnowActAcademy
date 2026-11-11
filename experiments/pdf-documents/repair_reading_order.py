"""Use CTC character positions to interleave Chinese text and math correctly.

Line OCR can concatenate Chinese on both sides of a masked equation. Character
positions recover the actual order rather than treating that text as one span.
No formula is guessed from Chinese OCR. Empty answer brackets are kept from
their original source contours and removed from the prose recognizer's output.
"""
from concurrent.futures import ProcessPoolExecutor
from collections import Counter
import json
import math
import os
import time
import cv2
import fitz
import numpy as np
from PIL import Image,ImageDraw
from rapidocr import RapidOCR
from rapidocr.ch_ppocr_rec.typings import TextRecInput
from glyphs import CACHE,ROOT
from extract import normalize_crop
from raster_blanks import detect
from assemble import ordered_lines

SUP=ROOT/'.cache/supplement-transcription'
OCR=None


def prepare():
    global OCR
    cv2.setNumThreads(1)
    OCR=RapidOCR(params={'EngineConfig.onnxruntime.intra_op_num_threads':1,
                         'EngineConfig.onnxruntime.inter_op_num_threads':1,'Global.use_cls':False})


def inside_formula(text,formulas):
    x0,y0,x1,y1=text['bbox']
    for n in formulas:
        a,b,c,d=n['bbox']
        if min(y1,d)-max(y0,b)<(y1-y0)*.4:continue
        if x0+2<a<x1-2 and c<x1+2:return True
    return False


def save_formula(image):
    fid,_,png=normalize_crop(image.convert('L'),fitz.Rect(0,0,*image.size))
    destination=CACHE/'crops'/(fid+'.png')
    if not destination.exists():
        temporary=destination.with_suffix('.'+str(os.getpid())+'.tmp');temporary.write_bytes(png);temporary.replace(destination)
    return fid


def repair(job):
    row,is_stem=job;nodes=row['nodes'];formulas=[n for n in nodes if n['kind']=='formula']
    selected=[n for n in nodes if n['kind']=='text' and inside_formula(n,formulas)]
    with Image.open(SUP/'images'/(row['id']+'.png')) as raw:image=raw.convert('RGB')
    count=0;word_alignment=[]
    if selected:
        masked=image.copy();draw=ImageDraw.Draw(masked)
        for formula in formulas:draw.rectangle(formula['bbox'],fill='white')
        boxes=[];crops=[]
        for n in selected:
            x0,y0,x1,y1=n['bbox'];box=[max(0,math.floor(x0)),max(0,math.floor(y0)),min(image.width,math.ceil(x1)),min(image.height,math.ceil(y1))]
            if box[2]<=box[0] or box[3]<=box[1]:continue
            boxes.append((n,box));crops.append(np.array(masked.crop(box)))
        if crops:
            output=OCR.text_rec(TextRecInput(img=crops,return_word_box=True))
            replacement=[];replaced=[]
            for (old,box),text,word_info,score in zip(boxes,output.txts,output.word_results,output.scores):
                if not word_info.line_txt_len:continue
                x0,y0,x1,y1=box;glyph_width=(y1-y0)*.9
                chars=[(char,column) for word,columns in zip(word_info.words,word_info.word_cols) for char,column in zip(word,columns)]
                if not chars:continue
                for char,column in chars:
                    cx=x0+(column+.5)*(x1-x0)/word_info.line_txt_len
                    replacement.append({'kind':'text','text':char,'confidence':float(score),
                                        'bbox':[max(x0,cx-glyph_width/2),y0,min(x1,cx+glyph_width/2),y1],
                                        'positionEvidence':'CTC-character-alignment'})
                replaced.append(old);count+=1
                word_alignment.append({'before':old['text'],'after':text,'bbox':box})
            nodes=[n for n in nodes if n not in replaced]+replacement
    blank_updates={};placeholder=False
    if is_stem:
        scale=3
        enlarged=image.resize((image.width*scale,image.height*scale),Image.Resampling.LANCZOS)
        blank=detect(enlarged)
        if blank:
            opening=[v/scale for v in blank['opening']];closing=[v/scale for v in blank['closing']]
            a,b,c,d=opening;e,f,g,h=closing;height=max(d,h)-min(b,f)
            suffix=r'[\quad]' if blank['blank']=='[]' else r'(\quad)'
            parents=[n for n in formulas if n['bbox'][0]<a-height*.3 and n['bbox'][2]>a
                     and min(n['bbox'][3],h)-max(n['bbox'][1],b)>height*.4]
            evidence={'sourceImageId':row['id'],'opening':opening,'closing':closing,
                      'method':'empty-source-bracket-contours'}
            if parents:
                parent=max(parents,key=lambda n:n['bbox'][0]);x0,y0,x1,y1=parent['bbox']
                prefix=image.crop((max(0,math.floor(x0)-1),max(0,math.floor(y0)-2),math.floor(a),min(image.height,math.ceil(y1)+2)))
                try:child=save_formula(prefix)
                except ValueError:child=None
                if child:
                    blank_updates[parent['id']]={'prefixId':child,'suffix':suffix,'evidence':evidence,'method':evidence['method']}
                    nodes=[n for n in nodes if n['kind']!='text' or (n['bbox'][0]+n['bbox'][2])/2<a-height*.2
                           or (n['bbox'][1]+n['bbox'][3])/2<min(b,f)-height*.2
                           or (n['bbox'][1]+n['bbox'][3])/2>max(d,h)+height*.2]
                    placeholder=True
            else:
                cropped=image.crop((math.floor(a),math.floor(min(b,f)),math.ceil(g),math.ceil(max(d,h))))
                try:literal_id=save_formula(cropped)
                except ValueError:literal_id=None
                if literal_id:
                    # Keep prose before the opening bracket; all detected content
                    # inside this visually empty answer gap is an OCR artifact.
                    cleaned=[]
                    for n in nodes:
                        x0,y0,x1,y1=n['bbox'];cx=(x0+x1)/2;cy=(y0+y1)/2
                        if n['kind']=='text' and x0<a<x1 and x1<=g+height*.5:
                            n={**n,'text':__import__('re').sub(r'[\[［【『].*$','',n['text'])}
                            if not n['text'].strip():continue
                            n['bbox']=[x0,y0,min(x1,a),y1];cx=(x0+min(x1,a))/2
                        if a-height*.2<=cx<=g+height*.2 and min(b,f)-height*.2<=cy<=max(d,h)+height*.2:continue
                        cleaned.append(n)
                    nodes=cleaned+[{'kind':'formula','id':literal_id,'bbox':[a,min(b,f),g,max(d,h)],
                                    'type':'source-empty-answer-brackets','detectionConfidence':None}]
                    blank_updates[literal_id]={'prefixId':None,'suffix':suffix,'evidence':evidence,'method':evidence['method']}
                    placeholder=True
    if not count and not placeholder:return {'id':row['id'],'changed':False,'blankUpdates':{}}
    grouped=[]
    for line in ordered_lines(nodes):
        line_nodes=[]
        for node in line:
            if node['kind']=='text' and line_nodes and line_nodes[-1]['kind']=='text':
                previous=line_nodes[-1];gap=node['bbox'][0]-previous['bbox'][2]
                if gap<max(node['bbox'][3]-node['bbox'][1],previous['bbox'][3]-previous['bbox'][1])*.65:
                    previous['text']+=node['text'];previous['confidence']=min(previous['confidence'],node['confidence'])
                    previous['bbox']=[min(previous['bbox'][0],node['bbox'][0]),min(previous['bbox'][1],node['bbox'][1]),
                                      max(previous['bbox'][2],node['bbox'][2]),max(previous['bbox'][3],node['bbox'][3])]
                    continue
            line_nodes.append(dict(node))
        grouped.extend(line_nodes)
    return {'id':row['id'],'changed':True,'record':{**row,'nodes':grouped,'characterAlignment':word_alignment,
                                                     'readingOrderRepair':'CTC-positions-and-source-bracket-contours'},
            'blankUpdates':blank_updates,'alignedSpans':count,'placeholder':placeholder}


def main():
    inventory=json.loads((SUP/'inventory.json').read_text());stems={q['rows'][0]['images'][0] for q in inventory['questions']}
    rows={}
    for name in ['segments.jsonl','segments-overrides.jsonl']:
        for line in (SUP/name).open():
            row=json.loads(line);rows[row['id']]=row
    target=SUP/'segments-reading-order-v2.jsonl';seen=set()
    if target.exists():seen={json.loads(line)['id'] for line in target.open()}
    jobs=[(r,r['id'] in stems) for r in rows.values() if r['id'] not in seen and
          (r['id'] in stems or any(inside_formula(n,[f for f in r['nodes'] if f['kind']=='formula']) for n in r['nodes'] if n['kind']=='text'))]
    blanks_path=SUP/'blank-formulas.json';blanks=json.loads(blanks_path.read_text()) if blanks_path.exists() else {}
    start=time.monotonic();counts=Counter()
    with ProcessPoolExecutor(max_workers=4,initializer=prepare) as pool,target.open('a') as stream:
        for i,result in enumerate(pool.map(repair,jobs,chunksize=1),1):
            counts['imagesChecked']+=1
            if result['changed']:
                stream.write(json.dumps(result['record'],ensure_ascii=False)+'\n');blanks.update(result['blankUpdates'])
                counts['imagesRepaired']+=1;counts['alignedTextSpans']+=result['alignedSpans'];counts['sourceAnswerBlanks']+=int(result['placeholder'])
            if i%100==0:
                stream.flush();temporary=blanks_path.with_suffix('.tmp');temporary.write_text(json.dumps(blanks));temporary.replace(blanks_path)
                print(json.dumps({**counts,'total':len(jobs),'seconds':round(time.monotonic()-start,1)}),flush=True)
    blanks_path.write_text(json.dumps(blanks));print(json.dumps({**counts,'seconds':round(time.monotonic()-start,1)}),flush=True)


if __name__=='__main__':main()
