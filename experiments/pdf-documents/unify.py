"""Unify both editions as an explicitly labelled, reviewable native-text draft.

Original IDs and option order survive. New IDs use the source image content,
independent of section filenames and question numbering. Uncertain matches are
never silently merged. All alternative analyses remain in the review artifact.
"""
from collections import Counter,defaultdict
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import unicodedata

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/pdf-transcription'
SUP=ROOT/'.cache/supplement-transcription'


def digest(value):return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True).encode()).hexdigest()


def normalized_name(value):return re.sub(r'[\s、，,()（）]','',unicodedata.normalize('NFKC',value))


def image_key(q):
    return (q['subjectId'],q['rows'][0]['images'][0],tuple(sorted(row['images'][0] for row in q['rows'][1:5])))


def analysis_version(q):
    part=q['transcription']['parts'].get('analysis',{})
    return {'text':q.get('analysis',''),'sourceQuestionId':q['id'],'status':part.get('status'),
            'sourceImageId':part.get('sourceImageId',part.get('rasterSource')),
            'source':q.get('source')}


def unify():
    original=json.loads((OUT/'original-native-draft.json').read_text())
    supplement=json.loads((OUT/'supplement-native-draft.json').read_text())['questions']
    comparison=json.loads((OUT/'semantic-comparison.json').read_text())
    resolutions=json.loads((ROOT/'experiments/pdf-documents/manual-resolutions.json').read_text())
    for match in resolutions.get('questionMatches',[]):
        if not any(r['supplementId']==match['supplementId'] for r in comparison['matches']):comparison['matches'].append(match)
    resolved_conflicts=[]
    for resolution in resolutions['answerConflicts']:
        conflict=next((r for r in comparison['conflicts'] if r['originalId']==resolution['originalId'] and r['supplementId']==resolution['supplementId']),None)
        if conflict:
            comparison['matches'].append({**conflict,'evidence':resolution['reviewMethod'],'resolvedAnswer':resolution['answer']})
            resolved_conflicts.append({**conflict,**resolution})
            comparison['conflicts'].remove(conflict)
    inventory=json.loads((SUP/'inventory.json').read_text());files={row['id']:row for row in inventory['files']}
    merged=deepcopy(original);questions=merged['questions'];by_id={q['id']:q for q in questions}
    source_questions={q['id']:q for q in supplement}
    section_by_key={};section_by_name={};section_for_file={};new_sections=[]
    for section in merged['sections']:
        section_by_name[(section['subjectId'],normalized_name(section['name']))]=section
        if section.get('number'):section_by_key[(section['subjectId'],section['number'])]=section
    for file in files.values():
        number=re.match(r'\d+(?:\.\d+)+',file['sectionName'])
        section=section_by_key.get((file['subjectId'],number[0])) if number else None
        section=section or section_by_name.get((file['subjectId'],normalized_name(file['sectionName'])))
        if not section:
            if file['subjectId']=='linear':
                linear_parents={'向量的线性表示、向量组的线性相关性':3,'向量空间':7}
                if file['sectionName'] not in linear_parents:raise ValueError('Unknown supplementary classification '+file['sectionName'])
                chapter_no=linear_parents[file['sectionName']];section_number='linear-'+file['sectionName'];parent_id='linear-chapter-'+str(chapter_no)
            else:
                if not number:raise ValueError('Unknown supplementary classification '+file['sectionName'])
                chapter_no=int(number[0].split('.')[0]);section_number=number[0];parent_id='chapter-'+str(chapter_no)
            sid='u-section-'+digest([file['subjectId'],section_number])[:12]
            section={'id':sid,'name':file['sectionName'],'subjectId':file['subjectId'],
                     'parentId':parent_id,'chapterNo':chapter_no,'number':section_number,
                     'file':file['path'],'sha256':file['sha256'],'questionCount':0}
            new_sections.append(section);merged['sections'].append(section)
        section_for_file[file['id']]=section['id']
    supplement_to_original={row['supplementId']:row for row in comparison['matches']}
    groups=defaultdict(list)
    for q in supplement:groups[image_key(q)].append(q)
    aliases={};reports=[];sources=defaultdict(list);versions=defaultdict(list);source_errors=[]
    for q in questions:
        sources[q['id']].append({'edition':'pdf','sourceQuestionId':q['id'],**q['source']})
        versions[q['id']].append(analysis_version(q))
    for key,group in groups.items():
        known=[supplement_to_original[q['id']] for q in group if q['id'] in supplement_to_original]
        if known:
            target_id=known[0]['originalId'];target=by_id[target_id]
        else:
            q=group[0];target_id='u-'+q['subjectId']+'-'+digest(key)[:16]
            file=files[q['documentId']]
            target={key:deepcopy(q[key]) for key in ['stem','options','answer','analysis','transcription','subjectId']}
            target.update(id=target_id,chapterId=section_for_file[q['documentId']],type='single',
                          acceptedAnswers=[],difficulty='medium',tags=[q['chapterLabel'],'NEU 小站补充'],
                          sourceLabel=q['chapterLabel']+' · 补充第 '+str(q['sourceNumber'])+' 题',
                          source={'documentId':q['documentId'],'file':file['path'],'sha256':file['sha256'],
                                  'questionNumber':q['sourceNumber'],'format':'html',
                                  'answerEvidence':{'greenOption':q['answerEvidence'][0]}},
                          answerVerified=q['structureVerified'],analysisMissing=not q['analysis'].strip())
            questions.append(target);by_id[target_id]=target
        for q in group:
            aliases[q['id']]=target_id;file=files[q['documentId']]
            sources[target_id].append({'edition':'supplement','sourceQuestionId':q['id'],
                                      'file':file['path'],'sha256':file['sha256'],'questionNumber':q['sourceNumber']})
            version=analysis_version(q)
            if q['id'] in supplement_to_original:version['optionMapping']=supplement_to_original[q['id']]['optionMapping']
            if version['text'].strip() and not any(v['text']==version['text'] for v in versions[target_id]):versions[target_id].append(version)
            if not target.get('analysis','').strip() and q['analysis'].strip():
                target['analysis']=q['analysis'];target['analysisMissing']=False
                target['transcription']['parts']['analysis']=deepcopy(q['transcription']['parts']['analysis'])
                reports.append({'questionId':target_id,'action':'filled-missing-analysis','sourceQuestionId':q['id']})
            if q['id'] in supplement_to_original:
                reports.append({'questionId':target_id,'action':'merged-equivalent-question',**supplement_to_original[q['id']]})
        if len(group)>1:reports.append({'questionId':target_id,'action':'merged-pixel-identical-supplements','sources':[q['id'] for q in group]})
    counts=Counter(q['chapterId'] for q in questions)
    for section in merged['sections']:section['questionCount']=counts[section['id']]
    new_by_parent=defaultdict(list)
    for section in new_sections:new_by_parent[section['parentId']].append(section)
    calculus_names={8:'第8章 多重积分',9:'第9章 曲线积分与曲面积分',10:'第10章 微分方程'}
    for subject in merged['subjects']:
        parents={chapter['id']:chapter for chapter in subject['chapters']}
        for section in new_sections:
            if section['subjectId']!=subject['id']:continue
            pid=section['parentId']
            if pid not in parents:
                parent={'id':pid,'name':calculus_names[section['chapterNo']],'children':[]}
                subject['chapters'].append(parent);parents[pid]=parent
            parents[pid]['children'].append({'id':section['id'],'name':section['name'],'questionCount':counts[section['id']]})
        for parent in subject['chapters']:
            for child in parent.get('children',[]):child['questionCount']=counts[child['id']]
            parent['questionCount']=sum(child['questionCount'] for child in parent.get('children',[]))
        if subject['id']=='calculus':subject['chapters'].sort(key=lambda c:int(c['id'].split('-')[-1]))
    review={};fully_checked=0
    for q in questions:
        transcription=q.pop('transcription');parts=transcription['parts'];statuses=Counter(p['status'] for p in parts.values())
        if q['id']=='s-6d7a175c5f89-q0034' or parts.get('analysis',{}).get('manualReview',{}).get('sourceQuestionId')=='s-6d7a175c5f89-q0034':
            corrected_stem=r'函数 \(f(x)=\sqrt[3]{x-1}\) 在区间 \([e,\pi]\) 上应用拉格朗日中值定理，可以得到下列哪个不等式？'
            corrected_a=r'\(e-1<\frac{1}{\sqrt{27\left(\frac{\sqrt[3]{\pi-1}-\sqrt[3]{e-1}}{\pi-e}\right)^3}}<\pi-1\)'
            corrected_analysis=r'记 \(m=\dfrac{\sqrt[3]{\pi-1}-\sqrt[3]{e-1}}{\pi-e}>0\)。由拉格朗日中值定理，存在 \(\xi\in(e,\pi)\)，使 \(m=f^{\prime}(\xi)=1/[3(\xi-1)^{2/3}]\)。解得 \(\xi=1+1/\sqrt{27m^3}\)，所以 \(e-1<1/\sqrt{27m^3}<\pi-1\)，选 A。原解析及选项漏掉倒数和系数，统一稿已更正。'
            for name,text in [('stem',corrected_stem),('option-A',corrected_a),('analysis',corrected_analysis)]:
                before=parts.get(name,{}).get('text','')
                reports.append({'questionId':q['id'],'action':'corrected-source-mathematical-error','part':name,'before':before,'after':text})
                parts[name]={'text':text,'status':'source-checked','manualReview':{'editorial':True,'sourceErratum':True,
                             'sourceQuestionId':'s-6d7a175c5f89-q0034','reviewMethod':'mean-value-theorem-and-explicit-algebra'}}
            q['stem']=corrected_stem;q['options'][0]['text']=corrected_a;q['analysis']=corrected_analysis
            q['answer']='A';q['answerVerified']=True
        checked=all(p['status']=='source-checked' for p in parts.values())
        if checked:fully_checked+=1
        if any(p['status']=='source-answer-error' for p in parts.values()):
            q['answerVerified']=False;source_errors.append(q['id'])
        q['analysisMissing']=not q.get('analysis','').strip()
        q['searchText']=re.sub(r'\s+',' ',q['sourceLabel']+' '+q['stem'])
        q['provenance']=sources[q['id']]
        review[q['id']]={'status':'source-checked' if checked else 'review-required','parts':parts,
                         'analysisVersions':versions[q['id']],'sourceCount':len(sources[q['id']])}
    merged['revision']='pdf-native-draft-'+digest([[q['id'],q['stem'],q['analysis']] for q in questions])[:16]
    merged['sourcePdfRevision']=original['revision'];merged['transcriptionDraft']=True
    merged['source']={'name':'知行学习统一题库校对稿','note':'PDF 原版与 NEU 小站补充版；检查尚未通过的内容未替换正式题库。'}
    summary={'originalQuestions':len(original['questions']),'supplementQuestions':len(supplement),
             'unifiedQuestions':len(questions),'originalIdsPreserved':all(q['id'] in by_id for q in original['questions']),
             'newQuestions':len(questions)-len(original['questions']),'mergedSupplementQuestions':len(supplement)-(len(questions)-len(original['questions'])),
             'fullySourceCheckedQuestions':fully_checked,'analysisMissing':sum(q['analysisMissing'] for q in questions),
             'sourceAnswerErrors':len(source_errors),'answerConflicts':len(comparison['conflicts']),
             'newSections':len(new_sections),'subjects':dict(Counter(q['subjectId'] for q in questions))}
    for name,payload in [('unified-native-draft.json',merged),('unified-review.json',{'summary':summary,'questions':review}),
                         ('unification-report.json',{'summary':summary,'actions':reports,'sourceAnswerErrors':source_errors,
                                                      'resolvedAnswerConflicts':resolved_conflicts,
                                                      'answerConflicts':comparison['conflicts'],'questionAliases':aliases})]:
        target=OUT/name;temporary=target.with_suffix('.tmp');temporary.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n');temporary.replace(target)
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__=='__main__':unify()
