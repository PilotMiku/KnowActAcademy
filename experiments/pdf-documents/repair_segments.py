"""Recover small mathematical images missed by both initial detectors."""
import json
import fitz
import numpy as np
from PIL import Image
from glyphs import CACHE,ROOT
from extract import normalize_crop


def main():
    directory=ROOT/'.cache/supplement-transcription'
    rows={r['id']:r for line in (directory/'segments.jsonl').open() if (r:=json.loads(line))}
    target=directory/'segments-overrides.jsonl'
    overrides={r['id']:r for line in target.open() if (r:=json.loads(line))} if target.exists() else {}
    recovered=0;blank=0
    for fid,row in rows.items():
        if row['nodes'] or fid in overrides:continue
        with Image.open(directory/'images'/(fid+'.png')) as image:
            gray=image.convert('L')
            if np.count_nonzero(np.array(gray)<180)<5:blank+=1;continue
            formula,_,png=normalize_crop(gray,fitz.Rect(0,0,*image.size))
            (CACHE/'crops'/(formula+'.png')).write_bytes(png)
            overrides[fid]={**row,'nodes':[{'kind':'formula','id':formula,'type':'missed-math-image',
                                           'bbox':[0,0,*image.size],'detectionConfidence':None}],
                            'repair':'nonempty-source-image-had-no-detected-content'};recovered+=1
    temporary=target.with_suffix('.tmp');temporary.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in overrides.values()));temporary.replace(target)
    print(json.dumps({'recoveredNonemptyImages':recovered,'totalOverrides':len(overrides),'sourceBlankImages':blank}))


if __name__=='__main__':main()
