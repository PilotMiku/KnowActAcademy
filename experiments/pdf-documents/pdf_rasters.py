"""Link embedded PDF raster blocks with the supplied supplementary originals."""
from collections import defaultdict
import hashlib
import io
import json
from pathlib import Path
import fitz
from PIL import Image
from glyphs import ROOT,CACHE
from extract import local_source_path


def pixels(image):
    return hashlib.sha256(image.tobytes()+str(image.size).encode()).hexdigest()


def main():
    supplemental=ROOT/'.cache/supplement-transcription'
    inventory=json.loads((supplemental/'inventory.json').read_text())
    sizes=defaultdict(list)
    for image in inventory['images']:
        if not image.get('decodeError'):sizes[(image['width'],image['height'])].append(image['id'])
    data=json.loads((CACHE/'extraction.json').read_text())
    sources={d['documentId']:d['source'] for d in data['documents']}
    lookup={q['id']:q for d in data['documents'] for q in d['questions']}
    links=[];docs={};fingerprints={};matches=0
    for item in data['figures']:
        qid=item['questionId'];did=next(d['documentId'] for d in data['documents'] if any(q['id']==qid for q in d['questions']))
        if did not in docs:docs[did]=fitz.open(local_source_path(ROOT,sources[did]['path']))
        doc=docs[did];page=doc[item['page']-1]
        candidates=[image for image in page.get_image_info(xrefs=True)
                    if max(abs(a-b) for a,b in zip(image['bbox'],item['bbox']))<.001]
        if len(candidates)!=1 or not candidates[0].get('xref'):
            raise ValueError('Cannot locate source raster '+qid)
        raw=doc.extract_image(candidates[0]['xref'])['image']
        with Image.open(io.BytesIO(raw)) as original:
            rgba=original.convert('RGBA');bg=Image.new('RGBA',rgba.size,'white');bg.alpha_composite(rgba);image=bg.convert('RGB')
        fingerprint=pixels(image);fid=None
        for candidate in sizes[image.size]:
            if candidate not in fingerprints:
                with Image.open(supplemental/'images'/(candidate+'.png')) as other:
                    fingerprints[candidate]=pixels(other.convert('RGB'))
            if fingerprints[candidate]==fingerprint:fid=candidate;matches+=1;break
        if fid is None:
            fid=hashlib.sha256(raw).hexdigest()[:24]
            image.save(supplemental/'images'/(fid+'.png'))
        links.append({**item,'documentId':did,'imageId':fid,'size':list(image.size),
                      'matchesSupplementImage':fid in {r['id'] for r in inventory['images']}})
    for document in docs.values():document.close()
    (supplemental/'original-raster-parts.json').write_text(json.dumps({'parts':links},ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'originalRasterParts':len(links),'pixelIdenticalSupplementImages':matches}),flush=True)


if __name__=='__main__':main()
