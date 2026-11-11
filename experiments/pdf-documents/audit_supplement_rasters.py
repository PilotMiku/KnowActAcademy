"""Screen supplementary formulas against their own original raster contours."""
from concurrent.futures import ProcessPoolExecutor
import json
import hashlib
import subprocess
import time
import cv2
from PIL import Image
from glyphs import ROOT,CACHE
from audit_rasters import ink,rendered_ink,compare
from audit_shapes import variants

RENDERER=None


def prepare():
    global RENDERER
    cv2.setNumThreads(1)
    RENDERER=subprocess.Popen(['node',str(ROOT/'experiments/pdf-documents/mathjax.cjs')],
                               stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,bufsize=1)


def screen(job):
    fid,row=job
    with Image.open(CACHE/'crops'/(fid+'.png')) as image:source=ink(image)
    final={'id':fid,'passed':False,'reason':'latex-render-error'}
    for text in variants(row['text']):
        RENDERER.stdin.write(json.dumps({'id':fid,'text':text})+'\n');RENDERER.stdin.flush()
        rendered=json.loads(RENDERER.stdout.readline())
        if rendered.get('error') or not rendered.get('svg'):continue
        try:result=compare(source,rendered_ink(rendered['svg']))
        except Exception as error:result={'passed':False,'reason':'raster-parse-error','error':str(error)}
        final={'id':fid,'text':text,**result}
        if final['passed']:break
    return {**final,'screeningOnly':True,'thresholdVersion':3,'ocrTextHash':hashlib.sha256(row['text'].encode()).hexdigest(),
            'confidence':row['confidence'],'minimumTokenConfidence':row['minimumTokenConfidence']}


def main():
    supplementary=ROOT/'.cache/supplement-transcription'
    ids=set()
    for name in ['segments.jsonl','segments-overrides.jsonl']:
        for line in (supplementary/name).open():
            ids.update(n['id'] for n in json.loads(line)['nodes'] if n['kind']=='formula')
    blank=supplementary/'blank-formulas.json'
    if blank.exists():
        blanks=json.loads(blank.read_text());ids-=set(blanks)
        ids.update(row['prefixId'] for row in blanks.values() if row['prefixId'])
    records={r['id']:r for line in (CACHE/'recognition.jsonl').open() if (r:=json.loads(line))}
    target=CACHE/'raster-audit-v3-screening.jsonl';attempted={}
    if target.exists():
        for line in target.open():
            row=json.loads(line);attempted[row['id']]=row['ocrTextHash']
    pending=[(fid,records[fid]) for fid in sorted(ids&set(records)) if not records[fid]['truncated'] and
             attempted.get(fid)!=hashlib.sha256(records[fid]['text'].encode()).hexdigest()]
    start=time.monotonic();passed=0
    print(json.dumps({'pending':len(pending)}),flush=True)
    with ProcessPoolExecutor(max_workers=4,initializer=prepare) as pool,target.open('a') as stream:
        for index,row in enumerate(pool.map(screen,pending,chunksize=1),1):
            stream.write(json.dumps(row,ensure_ascii=False)+'\n');passed+=bool(row['passed'])
            if index%100==0:
                stream.flush();print(json.dumps({'checked':index,'total':len(pending),'passed':passed,
                                                 'seconds':round(time.monotonic()-start,1)}),flush=True)
    print(json.dumps({'checked':len(pending),'passed':passed,'seconds':round(time.monotonic()-start,1)}),flush=True)


if __name__=='__main__':main()
