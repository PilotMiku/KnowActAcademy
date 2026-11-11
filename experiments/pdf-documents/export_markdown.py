"""Export an image-free Markdown transcription for every stable question ID.

Chapter files are kept in the repository; per-question files and a ZIP are
exported under artifacts. Syntax success is separate from source verification.
Unrenderable OCR is preserved in labelled code blocks, never silently dropped.
"""
from collections import Counter
from difflib import SequenceMatcher
import csv
import hashlib
import json
from pathlib import Path
import re
import subprocess
import shutil
from urllib.parse import quote
from zipfile import ZIP_DEFLATED, ZipFile

from assemble import ROOT, read
from latex_normalization import normalize

OUT=ROOT/'artifacts/题库Markdown'
TRACKED=ROOT/'question-bank-markdown'
MATH=re.compile(r'\\\(([\s\S]*?)\\\)')


def clean_markdown(text):
    return '\n'.join(line.rstrip() for line in text.splitlines()).strip()+'\n'


def main():
    bank=read(ROOT/'artifacts/pdf-transcription/unified-native-draft.json')
    review=read(ROOT/'artifacts/pdf-transcription/unified-review.json')['questions']
    site=read(ROOT/'dist/data/bank.json');sources={q['id']:q['source']['url'] for q in site['questions']}
    assert {q['id'] for q in bank['questions']}==set(sources)
    expressions=set()
    for record in review.values():
        for part in list(record['parts'].values())+record['analysisVersions']:
            expressions.update(normalize(m[1]).strip() for m in MATH.finditer(part.get('text','')))
    result=subprocess.run(['node',str(ROOT/'experiments/pdf-documents/check_latex.cjs')],
                          input=json.dumps(sorted(expressions)),capture_output=True,text=True,check=True)
    errors=json.loads(result.stdout)
    OUT.mkdir(parents=True,exist_ok=True);TRACKED.mkdir(exist_ok=True)
    totals=Counter();records=[];chapter_rows=[];manifest={}

    def text_part(part,stats):
        value=part.get('text','').strip()
        if not value:
            stats['missingParts']+=1
            return '【原始资料缺少此部分，未补造内容。】'
        def math(match):
            original=match[1];text=normalize(original).strip();stats['formulaOccurrences']+=1
            if errors[text] is not None:
                stats['unrenderableFormulas']+=1
                return '\n\n【以下公式的识别结果尚不能可靠渲染，须对照原件修订】\n\n```latex\n'+text+'\n```\n\n'
            if text!=original:stats['normalizedFormulas']+=1
            if '\n' in text or len(text)>180 or re.search(r'\\begin\s*\{',text):
                return '\n\n$$\n'+text+'\n$$\n\n'
            return '$'+text+'$'
        output=MATH.sub(math,value)
        stats['truncatedFormulas']+=sum(e.get('status')=='ocr-truncated' for e in part.get('evidence',[]) if e['kind']=='formula')
        stats['sourceCheckedFormulas']+=sum(e.get('status') in {'source-contours-checked','manually-reviewed','independent-reading-checked','source-raster-brackets-checked'} for e in part.get('evidence',[]) if e['kind']=='formula')
        if '[公式待转写]' in output:stats['missingFormulas']+=output.count('[公式待转写]')
        return output

    for subject in bank['subjects']:
        for chapter in subject['chapters']:
            section_ids={chapter['id']}|{c['id'] for c in chapter.get('children',[])}
            questions=[q for q in bank['questions'] if q['subjectId']==subject['id'] and q['chapterId'] in section_ids]
            directory=OUT/subject['name']/chapter['name'];directory.mkdir(parents=True,exist_ok=True)
            chapter_text=['# '+subject['name']+' · '+chapter['name'],'',
                          f'共 {len(questions)} 题。文字与 LaTeX 转写稿；逐题状态见题目下方。', '',
                          '公式使用 Markdown 的 `$...$` / `$$...$$` 语法。可渲染并不表示已核实题意；未校验 OCR 均明确标注。','']
            for index,q in enumerate(questions,1):
                record=review[q['id']];parts=record['parts'];stats=Counter()
                status='已通过当前来源检查' if record['status']=='source-checked' else '含待对照原件核验的转写'
                content=['# '+q['sourceLabel'],'',f'题目 ID：`{q["id"]}`','',f'转写状态：{status}','',
                         f'[查看原始资料]({sources[q["id"]]})','', '## 题干','',text_part(parts['stem'],stats),'','## 选项','']
                for option in q['options']:
                    content += ['**'+option['id']+'.**', '',text_part(parts['option-'+option['id']],stats),'']
                content += ['## 答案','',str(q['answer']),'','## 解析','',text_part(parts.get('analysis',{}),stats),'']
                primary=parts.get('analysis',{});included=0
                if not primary.get('manualReview',{}).get('editorial'):
                    chinese=''.join(re.findall(r'[\u3400-\u9fff]',primary.get('text','')))
                    for version in record['analysisVersions']:
                        value=version.get('text','');mapping=version.get('optionMapping')
                        if not value or value==primary.get('text') or version.get('status') in {'source-image-missing','source-answer-error'}:continue
                        if mapping and any(a!=b for a,b in mapping.items()):continue
                        other=''.join(re.findall(r'[\u3400-\u9fff]',value))
                        extra_prose=len(other)>=20 and SequenceMatcher(None,chinese,other).ratio()<.75
                        extra_steps=value.count(r'\(')>primary.get('text','').count(r'\(')+2
                        if not extra_prose and not extra_steps:continue
                        content += ['## 另一份解析（保留来源，仍需对照核验）','',
                                    '来源题号：`'+version.get('sourceQuestionId','')+'`。','',text_part(version,stats),'']
                        included+=1;stats['alternativeAnalyses']+=1
                        if included>=2:break
                pending=[name for name,part in parts.items() if part['status']!='source-checked']
                if pending:content += ['## 校对状态','', '需对照原件的部分：'+ '、'.join(pending)+'。','',
                                      '文字与 LaTeX 已尽量转写。原始图片损坏、公式截断或识别无法确认的内容仍需补充核实。','']
                complete=not any(stats[k] for k in ['unrenderableFormulas','truncatedFormulas','missingParts','missingFormulas'])
                stats['questions']=1;stats['questionsWithCompleteRenderableText']=int(complete)
                stats['questionsSourceChecked']=int(record['status']=='source-checked')
                totals.update(stats)
                markdown=clean_markdown('\n'.join(content));path=directory/(q['id']+'.md');path.write_text(markdown)
                manifest[q['id']]={'file':path.relative_to(OUT).as_posix(),'sha256':hashlib.sha256(markdown.encode()).hexdigest()}
                row={'questionId':q['id'],'subject':subject['name'],'chapter':chapter['name'],
                     'completeRenderableText':complete,'sourceChecked':record['status']=='source-checked',
                     **dict(stats),'pendingParts':';'.join(pending),'source':sources[q['id']],'file':manifest[q['id']]['file']}
                records.append(row)
                chapter_text += ['## '+str(index)+'. '+q['sourceLabel'],'']+[line.replace('## ','### ',1) if line.startswith('## ') else line for line in content[2:]]+['---','']
            target=TRACKED/subject['name']/(chapter['name']+'.md');target.parent.mkdir(exist_ok=True)
            target.write_text(clean_markdown('\n'.join(chapter_text)))
            chapter_rows.append({'subject':subject['name'],'chapter':chapter['name'],'questions':len(questions),'file':target.relative_to(TRACKED).as_posix()})
    assert totals['questions']==len(site['questions'])
    fields=['questionId','subject','chapter','completeRenderableText','sourceChecked','formulaOccurrences',
            'sourceCheckedFormulas','unrenderableFormulas','truncatedFormulas','missingParts','missingFormulas','pendingParts','source','file']
    with (OUT/'逐题转写状态.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=fields,extrasaction='ignore');writer.writeheader();writer.writerows(records)
    stats={'revision':site['revision'],**dict(totals),'chapters':chapter_rows,'files':manifest,
           'syntaxErrorKinds':dict(Counter(error.split(':',2)[1].strip() if ':' in error else error for error in errors.values() if error))}
    (OUT/'manifest.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'data/markdown-transcription-report.json').write_text(json.dumps({k:v for k,v in stats.items() if k!='files'},ensure_ascii=False,indent=2)+'\n')
    introduction=['# 知行学习：文字与 LaTeX 题库','',f'本目录按 17 章保存全部 {totals["questions"]} 题的 Markdown 转写。原有题目 ID 保留；不引用题目截图。','',
                  f'其中 {totals["questionsWithCompleteRenderableText"]} 题的各部分均有非截断、可渲染的文字候选；{totals["questionsSourceChecked"]} 题通过当前全部来源检查。', '',
                  '**这是一份含待核验 OCR 的转写稿，不等于全题人工复核完成。** '+
                  '不能可靠渲染的公式以标注过的 LaTeX 代码保留；原始缺损明确标注，不补造题目。', '',
                  '每题附答案、解析、来源链接和校对状态。网页正式题库仍仅使用已检查公式，其余保留原式；本目录不加入 Pages 发布包。','',
                  '| 科目 | 章节 | 题量 |','| --- | --- | ---: |']
    introduction += ['| '+c['subject']+' | ['+c['chapter']+']('+quote(c['file'])+') | '+str(c['questions'])+' |' for c in chapter_rows]
    introduction += ['', '[下载全部单题 Markdown 和逐题清单](逐题Markdown.zip)。压缩包也随源码提交，但不加入 Pages 发布包。导出脚本为 `experiments/pdf-documents/export_markdown.py`。','']
    (TRACKED/'README.md').write_text(clean_markdown('\n'.join(introduction)))
    (OUT/'README.md').write_text('\n'.join(introduction[:9])+ '\n\n每道题独立保存为 .md；完整索引见 manifest.json，状态见逐题转写状态.csv。\n')
    archive=ROOT/'artifacts/知行学习-逐题Markdown.zip'
    with ZipFile(archive,'w',ZIP_DEFLATED,compresslevel=6) as bundle:
        for qid,record in sorted(manifest.items()):bundle.write(OUT/record['file'],record['file'])
        for name in ['README.md','manifest.json','逐题转写状态.csv']:bundle.write(OUT/name,name)
    shutil.copyfile(archive,TRACKED/'逐题Markdown.zip')
    print(json.dumps({k:v for k,v in stats.items() if k not in {'files','syntaxErrorKinds','chapters'}},ensure_ascii=False,indent=2),flush=True)
    print(json.dumps({'archiveBytes':archive.stat().st_size,'chapterFiles':len(chapter_rows)},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
