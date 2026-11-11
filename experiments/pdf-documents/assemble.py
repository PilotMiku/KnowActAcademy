"""Assemble inspectable native-text drafts without promoting unchecked OCR.

Formula evidence is kept per occurrence. A previous passing audit is never
overwritten by a later failed candidate. Original IDs and answer order survive.
"""
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from latex_normalization import normalize as normalize_latex

ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'.cache/pdf-transcription'
SUPPLEMENT=ROOT/'.cache/supplement-transcription'
OUTPUT=ROOT/'artifacts/pdf-transcription'


def read(path,default=None):
    return json.loads(path.read_text()) if path.exists() else default


def jsonl(path):
    if not path.exists():return
    with path.open() as stream:
        for line in stream:
            if line.strip():yield json.loads(line)


def ordered_lines(nodes):
    """Order mixed raster regions using text lines as the baseline anchors."""
    lines=[]
    for node in sorted(nodes,key=lambda n:(n['bbox'][1],n['bbox'][0])):
        if node['kind']!='text':continue
        x0,y0,x1,y1=node['bbox']
        match=None
        for line in lines:
            a,b=line['top'],line['bottom']
            if min(y1,b)-max(y0,a)>.5*min(y1-y0,b-a):match=line;break
        if match is None:
            match={'top':y0,'bottom':y1,'nodes':[]};lines.append(match)
        match['nodes'].append(node)
    for node in nodes:
        if node['kind']=='text':continue
        x0,y0,x1,y1=node['bbox'];eligible=[]
        for line in lines:
            overlap=min(y1,line['bottom'])-max(y0,line['top'])
            denominator=min(y1-y0,line['bottom']-line['top'])
            if overlap>.4*max(denominator,1):
                eligible.append((overlap/max(denominator,1),line))
        if eligible:max(eligible,key=lambda pair:pair[0])[1]['nodes'].append(node)
        else:lines.append({'top':y0,'bottom':y1,'nodes':[node]})
    return [sorted(line['nodes'],key=lambda n:n['bbox'][0])
            for line in sorted(lines,key=lambda line:line['top'])]


class Resolver:
    def __init__(self):
        self.recognized={r['id']:r for r in jsonl(CACHE/'recognition.jsonl')}
        revisions=read(CACHE/'source-revisions.json',{})
        self.verified={r['id']:r for r in jsonl(CACHE/'formula-audit.jsonl') if r.get('passed')
                       and r.get('sourceVersion',0)==revisions.get(r['id'],0)}
        self.aliases=read(CACHE/'formula-aliases.json',{})
        by_shape={self.aliases.get(fid,fid):row for fid,row in self.verified.items()}
        for fid,shape in self.aliases.items():
            if shape in by_shape and fid not in self.verified:
                self.verified[fid]={**by_shape[shape],'id':fid,'method':'identical-source-contours',
                                    'equivalentTo':by_shape[shape]['id']}
        self.compounds=read(CACHE/'compound-formulas.json',{})
        self.blanks=read(SUPPLEMENT/'blank-formulas.json',{})
        self.manual=read(ROOT/'experiments/pdf-documents/manual-formulas.json',{})
        self.independent={r['id']:r for r in jsonl(CACHE/'independent-math-verification.jsonl') if r.get('passed')}

    def formula(self,fid):
        if fid in self.manual:
            return {'id':fid,'text':self.manual[fid]['text'],'status':'manually-reviewed',
                    'evidence':self.manual[fid]}
        if fid in self.verified:
            row=self.verified[fid]
            return {'id':fid,'text':normalize_latex(row['text']),'status':'source-contours-checked','method':row['method']}
        if fid in self.independent:
            row=self.independent[fid]
            return {'id':fid,'text':row['text'],'status':'independent-reading-checked','method':row['method']}
        if fid in self.blanks:
            blank=self.blanks[fid]
            if not blank['prefixId']:
                return {'id':fid,'text':blank['suffix'],'status':'source-raster-brackets-checked',
                        'method':blank['method'],'evidence':blank['evidence']}
            prefix=self.formula(blank['prefixId'])
            if prefix['text'] and prefix['status'] not in {'ocr-truncated','missing'}:
                return {'id':fid,'text':prefix['text']+' '+blank['suffix'],
                        'status':'independent-reading-checked' if prefix['status'] in {'independent-reading-checked','source-contours-checked'} else 'ocr-review-required',
                        'method':blank['method'],'evidence':blank['evidence']}
        if fid in self.compounds:
            rows=[self.formula(child) for child in self.compounds[fid]]
            if all(row['status']!='missing' for row in rows):
                checked=all(row['status'] in {'source-contours-checked','manually-reviewed'} for row in rows)
                truncated=any(row['status']=='ocr-truncated' for row in rows)
                return {'id':fid,'text':r'\begin{gathered}'+r'\\'.join(row['text'] for row in rows)+r'\end{gathered}',
                        'status':'source-contours-checked' if checked else 'ocr-truncated' if truncated else 'ocr-review-required',
                        'method':'checked-source-rows' if checked else 'ocr-rows','children':rows}
        row=self.recognized.get(fid,self.recognized.get(self.aliases.get(fid)))
        if row:
            return {'id':fid,'text':normalize_latex(row['text']),'status':'ocr-truncated' if row['truncated'] else 'ocr-review-required',
                    'confidence':row['confidence'],'minimumTokenConfidence':row['minimumTokenConfidence']}
        return {'id':fid,'text':'','status':'missing'}


def native_part(nodes,resolver,raster=False):
    evidence=[];chunks=[]
    rows=ordered_lines(nodes) if raster else [nodes]
    for row in rows:
        text=[]
        for node in row:
            if node['kind']=='text':
                value=node['text'].replace('【解析】','').strip()
                if value:text.append(value)
                if raster:evidence.append({'kind':'text','text':value,'confidence':node['confidence']})
            elif node['kind']=='formula':
                formula=resolver.formula(node['id']);evidence.append({'kind':'formula',**formula})
                text.append(r'\('+formula['text']+r'\)' if formula['text'] else '[公式待转写]')
        if text:chunks.append(' '.join(text))
    checked=all(item.get('status') in {'source-contours-checked','manually-reviewed','independent-reading-checked','source-raster-brackets-checked'}
                for item in evidence if item['kind']=='formula')
    # Raster text still requires source comparison even when OCR reports 1.0.
    return {'text':'\n'.join(chunks),'evidence':evidence,
            'status':'raster-review-required' if raster else 'source-checked' if checked else 'review-required'}


def fingerprint(value):
    value=unicodedata.normalize('NFKC',value)
    value=re.sub(r'\\(?:left|right|displaystyle|textstyle|quad|qquad|,|;|!|\(|\))','',value)
    value=re.sub(r'\\(?:dfrac|tfrac)',r'\\frac',value)
    return re.sub(r'[\s，。；、:：.()（）\[\]【】]','',value)


def chinese(value):
    return ''.join(re.findall(r'[\u3400-\u9fff]',value)).replace('解析','')


def assemble():
    OUTPUT.mkdir(parents=True,exist_ok=True)
    resolver=Resolver();original=read(ROOT/'data/pdf-source-bank.json') or read(ROOT/'dist/data/bank.json')
    source=read(CACHE/'extraction.json');inventory=read(SUPPLEMENT/'inventory.json')
    segments={r['id']:r for r in jsonl(SUPPLEMENT/'segments.jsonl')}
    segments.update({r['id']:r for r in jsonl(SUPPLEMENT/'segments-overrides.jsonl')})
    segments.update({r['id']:r for r in jsonl(SUPPLEMENT/'segments-reading-order-v2.jsonl')})
    image_metadata={r['id']:r for r in inventory['images']}
    manual_parts=read(ROOT/'experiments/pdf-documents/manual-parts.json',{})
    rasters={(r['questionId'],r['part']):r for r in read(SUPPLEMENT/'original-raster-parts.json',{'parts':[]})['parts']}
    records={};formulas=Counter();missing=Counter()
    for document in source['documents']:
        for q in document['questions']:
            parts={}
            for name,nodes in q['parts'].items():
                part=native_part(nodes,resolver)
                raster=rasters.get((q['id'],name))
                if raster:
                    manual=manual_parts.get(raster['imageId'])
                    segment=segments.get(raster['imageId'])
                    if manual:
                        part['text']+='\n'+manual['text'];part['manualReview']=manual
                    elif segment:
                        embedded=native_part(segment['nodes'],resolver,True)
                        part['text']+='\n'+embedded['text'];part['evidence']+=embedded['evidence']
                    part['rasterSource']=raster['imageId']
                    part['status']='source-checked' if manual and part['status']=='source-checked' else 'raster-review-required'
                    if manual and manual.get('answerRequiresCorrection'):part['status']='source-answer-error'
                parts[name]=part
                for item in part['evidence']:
                    if item['kind']=='formula':formulas[item['status']]+=1
            records[q['id']]={'id':q['id'],'parts':parts,'source':document['source']}
    originals=[]
    for q in original['questions']:
        row=records[q['id']];parts=row['parts']
        originals.append({**q,'stem':parts['stem']['text'],
                          'options':[{'id':o['id'],'text':parts['option-'+o['id']]['text']} for o in q['options']],
                          'analysis':parts.get('analysis',{}).get('text',''),
                          'transcription':{'parts':parts,'status':'source-checked' if all(
                              p['status']=='source-checked' for p in parts.values()) else 'review-required'}})
    supplements=[]
    for q in inventory['questions']:
        parts={}
        for index,row in enumerate(q['rows']):
            name='stem' if index==0 else 'analysis' if index==5 else 'option-'+chr(64+index)
            image_id=row['images'][0];segment=segments.get(image_id)
            if image_id in manual_parts:
                manual=manual_parts[image_id]
                parts[name]={'text':manual['text'],'status':'source-answer-error' if manual.get('answerRequiresCorrection') else 'source-checked',
                             'sourceImageId':image_id,'manualReview':manual,'evidence':[]}
            elif segment:parts[name]={**native_part(segment['nodes'],resolver,True),'sourceImageId':image_id}
            else:
                invalid=image_metadata.get(image_id,{}).get('decodeError',False)
                parts[name]={'text':'','status':'source-image-missing' if invalid else 'not-transcribed','sourceImageId':image_id}
                missing[parts[name]['status']]+=1
        supplements.append({**q,'stem':parts['stem']['text'],
                            'options':[{'id':chr(65+i),'text':parts['option-'+chr(65+i)]['text']} for i in range(4)],
                            'answer':chr(65+q['answerEvidence'][0]),'analysis':parts['analysis']['text'],
                            'transcription':{'parts':parts,'status':'review-required'}})
    # Exact canonical matches are safe candidates only when option content and
    # correct-option content also agree. Similar Chinese stems are never merged.
    stem_index=defaultdict(list);chinese_index=defaultdict(list)
    for q in originals:
        stem_index[(q['subjectId'],fingerprint(q['stem']))].append(q)
        key=chinese(q['stem'])
        if len(key)>=5:chinese_index[(q['subjectId'],key)].append(q)
    matches=[];candidates=[];conflicts=[]
    for q in supplements:
        exact=stem_index.get((q['subjectId'],fingerprint(q['stem'])),[]) if q['stem'] else []
        if exact:
            for old in exact:
                left={fingerprint(o['text']):o['id'] for o in old['options']}
                right={fingerprint(o['text']):o['id'] for o in q['options']}
                if len(left)==4 and set(left)==set(right):
                    permutation={oid:right[text] for text,oid in left.items()}
                    entry={'originalId':old['id'],'supplementId':q['id'],'optionMapping':permutation}
                    if permutation[old['answer']]==q['answer']:matches.append(entry)
                    else:conflicts.append({**entry,'issue':'correct-answer-conflict'})
                else:candidates.append({'originalId':old['id'],'supplementId':q['id'],'reason':'stem-matches-options-differ-or-pending'})
        elif len(chinese(q['stem']))>=5:
            for old in chinese_index.get((q['subjectId'],chinese(q['stem'])),[]):
                candidates.append({'originalId':old['id'],'supplementId':q['id'],'reason':'same-Chinese-stem-mathematics-requires-comparison'})
    summary={'originalQuestions':len(originals),'supplementQuestions':len(supplements),
             'originalFullySourceChecked':sum(q['transcription']['status']=='source-checked' for q in originals),
             'originalFormulaOccurrences':dict(formulas),'rasterImagesSegmented':len(segments),
             'supplementPartsPending':dict(missing),'exactCrossVersionMatches':len(matches),
             'crossVersionCandidates':len(candidates),'answerConflicts':len(conflicts)}
    for name,payload in [('original-native-draft.json',{**original,'questions':originals}),
                         ('supplement-native-draft.json',{'format':'zhixing.transcription-draft.v1','questions':supplements}),
                         ('comparison.json',{'summary':summary,'matches':matches,'candidates':candidates,'conflicts':conflicts}),
                         ('progress.json',summary)]:
        target=OUTPUT/name;temporary=target.with_suffix('.tmp')
        temporary.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');temporary.replace(target)
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=='__main__':assemble()
