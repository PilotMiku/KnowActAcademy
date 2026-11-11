"""Retry used, truncated formulas with the model's full available sequence length."""
import json
import time
from assemble import CACHE, ROOT, Resolver, jsonl, read
from torch_ocr import TorchFormulaOCR


def main():
    review=read(ROOT/'artifacts/pdf-transcription/unified-review.json')['questions']
    used={e['id'] for q in review.values() for p in q['parts'].values() for e in p.get('evidence',[]) if e['kind']=='formula'}
    recognized={row['id']:row for row in jsonl(CACHE/'recognition.jsonl')}
    resolver=Resolver();pending=[]
    for fid in sorted(used):
        if fid not in recognized or not recognized[fid]['truncated']:continue
        if resolver.formula(fid)['status'] not in {'ocr-truncated','ocr-review-required'}:continue
        if not (CACHE/'crops'/(fid+'.png')).exists():continue
        pending.append(fid)
    config=read(CACHE/'models/mfr-1.5/config.json');maximum=min(768,config['decoder']['max_position_embeddings']-2)
    print(json.dumps({'pending':len(pending),'maxTokens':maximum}),flush=True)
    model=TorchFormulaOCR(half=True);complete=0;start=time.monotonic()
    with (CACHE/'recognition.jsonl').open('a') as output,(CACHE/'recognition-retries.jsonl').open('a') as evidence:
        for offset in range(0,len(pending),32):
            ids=pending[offset:offset+32]
            rows=model.recognize([CACHE/'crops'/(fid+'.png') for fid in ids],max_tokens=maximum)
            for fid,result in zip(ids,rows):
                row={'id':fid,**result,'retryReason':'previous-sequence-truncated','previousTokenLimit':recognized[fid]['tokens']}
                evidence.write(json.dumps(row,ensure_ascii=False)+'\n')
                if not row['truncated']:
                    output.write(json.dumps(row,ensure_ascii=False)+'\n');complete+=1
            output.flush();evidence.flush()
            print(json.dumps({'processed':min(offset+32,len(pending)),'total':len(pending),'completed':complete,'seconds':round(time.monotonic()-start,1)}),flush=True)


if __name__=='__main__':main()
