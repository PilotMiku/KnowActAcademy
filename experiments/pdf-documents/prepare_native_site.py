"""Prepare a faithful lean bank; uncertain formulas retain their original ink.

Canonical all-text drafts and audit evidence remain separate. Only checked
formula text is used in the site. Original diagrams and unresolved expressions
are stored as lossless WebP in 256 shared JSON chunks, avoiding tens of
thousands of tiny deployment files. Original PDFs/HTML stay in the repository.
"""
import argparse
import base64
from collections import Counter,defaultdict
import hashlib
import html
import io
import json
import math
from pathlib import Path
import re
import shutil
from difflib import SequenceMatcher
from urllib.parse import quote

import fitz
import numpy as np
from PIL import Image,ImageDraw
from assemble import ROOT,CACHE,SUPPLEMENT,Resolver,ordered_lines,jsonl,read

OUT=ROOT/'artifacts/pdf-transcription'
CHECKED={'source-contours-checked','independent-reading-checked','source-raster-brackets-checked','manually-reviewed'}


class Figures:
    def __init__(self):
        self.chunks=defaultdict(dict);self.sizes={};self.cache=ROOT/'.cache/native-figures';self.cache.mkdir(exist_ok=True)
    def add(self,image,kind='formula',height=None):
        image=image.convert('RGB')
        key=hashlib.sha256(image.tobytes()+str(image.size).encode()).hexdigest()[:24]
        if key not in self.sizes:
            target=self.cache/(key+'.webp')
            if not target.exists():
                output=io.BytesIO();image.save(output,'WEBP',lossless=True,method=4);target.write_bytes(output.getvalue())
            self.chunks[key[:2]][key]='data:image/webp;base64,'+base64.b64encode(target.read_bytes()).decode()
            self.sizes[key]=image.size
        attrs=f' data-kind="{kind}"'
        if kind=='formula' and height:attrs+=f' data-height="{min(30,max(.2,height)):.4f}"'
        return f'<img src="/api/question-figure/{key}" alt="原题公式"{attrs}>'
    def write(self,destination):
        staging=destination.with_name(destination.name+'.building')
        if staging.exists():shutil.rmtree(staging)
        staging.mkdir(parents=True)
        versions={}
        for prefix,figures in self.chunks.items():
            payload=json.dumps({'format':'zhixing.figure-chunk.v1','figures':figures},separators=(',',':'),sort_keys=True)
            version=hashlib.sha256(payload.encode()).hexdigest()[:16];versions[prefix]=version
            (staging/(prefix+'-'+version+'.json')).write_text(payload)
        if destination.exists():shutil.rmtree(destination)
        staging.replace(destination)
        return versions


class SiteBank:
    def __init__(self):
        self.resolver=Resolver();self.figures=Figures();self.counts=Counter();self.question_report={}
        self.source=read(CACHE/'extraction.json');self.originals={q['id']:q for d in self.source['documents'] for q in d['questions']}
        self.segments={}
        for name in ['segments.jsonl','segments-overrides.jsonl','segments-reading-order-v2.jsonl']:
            self.segments.update({r['id']:r for r in jsonl(SUPPLEMENT/name)})
        self.manual=read(ROOT/'experiments/pdf-documents/manual-parts.json',{})
        self.index=read(ROOT/'data/render-index.json');self.original_bank=read(ROOT/'data/pdf-source-bank.json') or read(ROOT/'dist/data/bank.json')
        self.native_source={q['id']:q for q in read(OUT/'original-native-draft.json')['questions']}
        self.original_formula={r['id']:r for r in jsonl(CACHE/'source-glyphs.jsonl')}
        self.syntax_errors={r['text'] for r in read(OUT/'latex-validation.json',{'errors':[]})['errors']}

    def native(self,text):return '<p>'+html.escape(text).replace('\n','<br>')+'</p>'

    def formula(self,node,source_image=None,font_height=16):
        value=self.resolver.formula(node['id'])
        if value['status'] in CHECKED and value['text'] and value['text'] not in self.syntax_errors:
            self.counts['nativeFormulaOccurrences']+=1
            return html.escape(r'\('+value['text']+r'\)')
        self.counts['preservedFormulaOccurrences']+=1
        if source_image is not None:
            box=node['bbox'];margin=2
            image=source_image.crop((max(0,math.floor(box[0])-margin),max(0,math.floor(box[1])-margin),
                                     min(source_image.width,math.ceil(box[2])+margin),min(source_image.height,math.ceil(box[3])+margin)))
            height=image.height/max(10,font_height)*1.1
        else:
            path=CACHE/'refined-crops'/(node['id']+'.png')
            if not path.exists():path=CACHE/'crops'/(node['id']+'.png')
            with Image.open(path) as raw:image=raw.convert('RGB')
            source=self.original_formula.get(node['id'],{});ems=[g.get('em',0) for g in source.get('glyphs',[]) if g.get('em')]
            em=max(ems) if ems else 9
            height=(node['bbox'][3]-node['bbox'][1])/max(em,1)*1.1*image.height/max(1,image.height-24)
        return self.figures.add(image,height=height)

    def pdf_part(self,qid,name):
        nodes=self.originals[qid]['parts'].get(name,[])
        for node in nodes:
            if node['kind']!='formula' or self.resolver.formula(node['id'])['status'] in CHECKED:continue
            region=fitz.Rect(node['bbox'])
            if any(n['kind']=='text' and fitz.Rect(n['bbox']).intersects(region) for n in nodes):
                self.counts['preservedWholePdfParts']+=1
                cache=ROOT/'.cache'/(self.index['revision']+'-raster-v2')
                images=[]
                for i,clip in enumerate(self.index['questions'][qid]['parts'][name]):
                    path=cache/qid/name/(str(i)+'.webp')
                    if path.exists():
                        with Image.open(path) as raw:images.append(self.figures.add(raw,kind='figure'))
                    else:raise ValueError('Missing source clip '+str(path))
                return '<p>'+''.join(images)+'</p>'
        result=[]
        for node in nodes:
            if node['kind']=='text':
                text=node['text'].replace('【解析】','')
                if text.strip():result.append(html.escape(text))
            else:result.append(self.formula(node))
        return '<p>'+''.join(result)+'</p>'

    def raster_part(self,image_id,cloze=False):
        if image_id in self.manual:
            self.counts['visuallyReviewedEmbeddedParts']+=1
            return self.native(self.manual[image_id]['text'])
        path=SUPPLEMENT/'images'/(image_id+'.png')
        if not path.exists():
            self.counts['missingSourceImages']+=1
            return '<p>原始资料的这部分图片已损坏，请查看原始资料。</p>'
        with Image.open(path) as raw:image=raw.convert('RGB')
        record=self.segments.get(image_id)
        if not record or not record['nodes']:
            self.counts['preservedWholeRasterParts']+=1
            return '<p>'+self.figures.add(image,kind='figure')+'</p>'
        mask=(np.array(image.convert('L'))<180)
        covered=Image.new('L',image.size,0);draw=ImageDraw.Draw(covered)
        for node in record['nodes']:
            a,b,c,d=node['bbox'];draw.rectangle((max(0,a-2),max(0,b-2),min(image.width,c+2),min(image.height,d+2)),fill=255)
        residual=mask & (np.array(covered)==0)
        low_text=any(n['kind']=='text' and n['confidence']<.90 and re.search(r'[\u3400-\u9fff]',n['text']) for n in record['nodes'])
        if residual.sum()>max(25,mask.sum()*.02) or low_text:
            self.counts['preservedWholeRasterParts']+=1
            return '<p>'+self.figures.add(image,kind='figure')+'</p>'
        heights=[n['bbox'][3]-n['bbox'][1] for n in record['nodes'] if n['kind']=='text' and re.search(r'[\u3400-\u9fff]',n['text'])]
        font_height=float(np.median(heights)) if heights else 16
        lines=[]
        for line in ordered_lines(record['nodes']):
            parts=[]
            for node in line:
                if node['kind']=='text':
                    text=node['text']
                    if cloze:
                        changed=re.sub(r'(为|是|奇偶性|周期|的值|个数|结果)\s*[\[［【『]\s*(?:[1Il一]\s*)?[.。]?\s*$',r'\1［　］',text)
                        self.counts['normalizedAnswerPlaceholders']+=int(changed!=text);text=changed
                    parts.append(html.escape(text))
                else:parts.append(self.formula(node,image,font_height))
            lines.append(''.join(parts))
        self.counts['nativeRasterProseParts']+=1
        return '<p>'+'<br>'.join(lines)+'</p>'

    def part(self,qid,name,record):
        if record.get('manualReview'):
            return self.native(record['text'])
        image_id=record.get('sourceImageId',record.get('rasterSource'))
        if image_id:return self.raster_part(image_id,cloze=name=='stem')
        if qid in self.originals:return self.pdf_part(qid,name)
        raise ValueError('Source part not found: '+qid+'/'+name)

    def prepare(self):
        bank=read(OUT/'unified-native-draft.json');review=read(OUT/'unified-review.json');errata=[]
        for q in bank['questions']:
            before=self.counts.copy();parts=review['questions'][q['id']]['parts']
            q['stem']=self.part(q['id'],'stem',parts['stem'])
            damaged=[key for key,record in parts.items() if key!='analysis' and record.get('status')=='source-image-missing']
            if damaged:
                q['stem']='<p><strong>原始资料有缺损：本题的题干或选项图片已损坏，暂不宜用于自测。</strong></p>'+q['stem']
                q['sourceIncomplete']=True;q['answerVerified']=False
                if '原始题目缺损' not in q['tags']:q['tags'].append('原始题目缺损')
                self.counts['sourceIncompleteQuestions']+=1
            for option in q['options']:
                option['text']=self.part(q['id'],'option-'+option['id'],parts['option-'+option['id']])
            analysis=parts.get('analysis',{'text':'','status':'source-image-missing'})
            q['analysis']=self.part(q['id'],'analysis',analysis) if analysis.get('text') or analysis.get('sourceImageId') or q['id'] in self.originals else '<p>原始资料未提供可用解析。</p>'
            if q.get('analysisMissing'):
                q['analysis']='<p>原始资料未提供可用解析。</p>'
                self.counts['missingAnalyses']+=1
            if not analysis.get('manualReview',{}).get('editorial'):
                primary_chinese=''.join(re.findall(r'[\u3400-\u9fff]',analysis.get('text','')))
                included=0
                for version in review['questions'][q['id']]['analysisVersions']:
                    if included>=2:break
                    if not version.get('sourceImageId') or version.get('text')==analysis.get('text') or version.get('sourceImageId')==analysis.get('sourceImageId',analysis.get('rasterSource')):continue
                    mapping=version.get('optionMapping')
                    if mapping and any(a!=b for a,b in mapping.items()):continue
                    text=version['text'];chinese=''.join(re.findall(r'[\u3400-\u9fff]',text))
                    extra_prose=len(chinese)>=20 and SequenceMatcher(None,primary_chinese,chinese).ratio()<.75
                    extra_steps=text.count(r'\(')>analysis.get('text','').count(r'\(')+2
                    if not extra_prose and not extra_steps:continue
                    content=self.raster_part(version['sourceImageId'])
                    q['analysis']+='<details><summary>另一份解析</summary>'+content+'</details>'
                    included+=1;self.counts['supplementaryAnalysesIncluded']+=1
            if not parts.get('option-A',{}).get('manualReview',{}).get('editorial') and (q['id']=='s-6d7a175c5f89-q0034' or analysis.get('manualReview',{}).get('sourceQuestionId')=='s-6d7a175c5f89-q0034'):
                old=q['options'][0]['text']
                corrected=r'\(e-1<\frac{1}{\sqrt{27\left(\frac{\sqrt[3]{\pi-1}-\sqrt[3]{e-1}}{\pi-e}\right)^3}}<\pi-1\)'
                q['options'][0]['text']=self.native(corrected);q['answer']='A';q['answerVerified']=True
                errata.append({'questionId':q['id'],'part':'option-A','before':old,'after':q['options'][0]['text'],
                               'reason':'由 m=1/[3(ξ−1)^(2/3)] 解出 ξ=1+1/√(27m³)，原选项漏倒数及系数。'})
            original_source=q['source'];original_source['format']='html' if original_source['file'].endswith('.html') else 'pdf'
            original_source['url']='https://github.com/PilotMiku/KnowActAcademy/blob/main/'+quote(original_source['file'],safe='/')
            if original_source['format']=='pdf':original_source['url']+='#page='+str(original_source.get('page',1))
            q['searchText']=re.sub(r'<[^>]+>',' ',q['sourceLabel']+' '+q['stem'])
            self.question_report[q['id']]={key:value-before[key] for key,value in self.counts.items() if value!=before[key]}
        bank['contentMode']='native';bank['transcriptionDraft']=False;bank['managedBundle']=True
        bank['source']={'name':'知行学习统一题库','note':'原版与 NEU 小站补充版统一；无法可靠确认的公式保留原始图像。'}
        bank['revision']='pdf-'+hashlib.sha256(json.dumps(bank['questions'],ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:16]
        referenced={fid for q in bank['questions'] for value in [q['stem'],q['analysis']]+[o['text'] for o in q['options']]
                    for fid in re.findall(r'/api/question-figure/([a-f0-9]{24})',value)}
        for prefix,items in list(self.figures.chunks.items()):
            self.figures.chunks[prefix]={fid:value for fid,value in items.items() if fid in referenced}
            if not self.figures.chunks[prefix]:del self.figures.chunks[prefix]
        self.figures.sizes={fid:size for fid,size in self.figures.sizes.items() if fid in referenced}
        versions=self.figures.write(OUT/'question-figures')
        def versioned(value):
            return re.sub(r'/api/question-figure/([a-f0-9]{24})',lambda m:'/api/question-figure/'+versions[m[1][:2]]+'/'+m[1],value)
        for number,q in enumerate(bank['questions'],1):
            q['stem']=versioned(q['stem']);q['analysis']=versioned(q['analysis'])
            for option in q['options']:option['text']=versioned(option['text'])
        bank['revision']='pdf-'+hashlib.sha256(json.dumps(bank['questions'],ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:16]
        (OUT/'site-bank.json').write_text(json.dumps(bank,ensure_ascii=False,separators=(',',':'))+'\n')
        summary={'questions':len(bank['questions']),'revision':bank['revision'],**self.counts,
                 'uniquePreservedImages':len(self.figures.sizes),'imageChunks':len(self.figures.chunks),
                 'bankBytes':(OUT/'site-bank.json').stat().st_size,
                 'figureBytes':sum(p.stat().st_size for p in (OUT/'question-figures').glob('*.json'))}
        (OUT/'native-site-report.json').write_text(json.dumps({'summary':summary,'questions':self.question_report,'editorialCorrections':errata},ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)
        return bank


def main(publish=False):
    prepared=SiteBank();bank=prepared.prepare()
    if publish:
        baseline=ROOT/'data/pdf-source-bank.json'
        if not baseline.exists():shutil.copyfile(ROOT/'dist/data/bank.json',baseline)
        shutil.copyfile(OUT/'site-bank.json',ROOT/'dist/data/bank.json')
        target=ROOT/'dist/question-figures'
        if target.exists():shutil.rmtree(target)
        shutil.copytree(OUT/'question-figures',target)
        manifest={'revision':bank['revision'],'contentMode':'native','documents':len(prepared.index['documents']),
                  'questions':len(bank['questions']),'sourcePdfRevision':bank['sourcePdfRevision'],
                  'subjects':[{'id':s['id'],'name':s['name'],'chapters':len(s['chapters']),
                               'questions':sum(q['subjectId']==s['id'] for q in bank['questions'])} for s in bank['subjects']]}
        (ROOT/'dist/data/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'))+'\n')
        report=read(OUT/'unification-report.json');summary=read(OUT/'native-site-report.json')['summary']
        registry=read(ROOT/'data/supplement-sources.json')
        registry.update(transcriptionStatus='converted-with-review-items',unifiedRevision=bank['revision'],
                        reviewSummary={key:summary[key] for key in ['nativeFormulaOccurrences','preservedFormulaOccurrences','missingAnalyses']})
        registry['reviewSummary'].update(fullySourceCheckedQuestions=report['summary']['fullySourceCheckedQuestions'],unifiedQuestions=len(bank['questions']))
        (ROOT/'data/supplement-sources.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n')
        audit={'format':'zhixing.questionbank-unification.v1','revision':bank['revision'],
               'summary':report['summary'],'rendering':summary,'resolvedAnswerConflicts':report['resolvedAnswerConflicts'],
               'editorialCorrections':[a for a in report['actions'] if a['action']=='corrected-source-mathematical-error'],
               'sourceErrata':[{'questionId':r['sourceQuestionId'],'part':r['sourcePart'],'correctedText':r['text'],
                                'reviewMethod':r['reviewMethod']} for r in prepared.manual.values() if r.get('sourceErratum')],
               'questionAliases':report['questionAliases'],
               'sourceIncompleteQuestions':[{'questionId':q['id'],'source':q['source']} for q in bank['questions'] if q.get('sourceIncomplete')],
               'limitations':['All-text OCR candidates remain a review draft. Unconfirmed expressions retain original images in the site.',
                              'Only confirmed equivalences are merged; unresolved similarities remain separate.',
                              'Absent source analyses are marked explicitly; no missing solutions are invented.']}
        (ROOT/'data/questionbank-unification.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--publish',action='store_true')
    main(parser.parse_args().publish)
