"""Export a visually transcribed sample, not automatic OCR. Never edits the live bank.

Run .venv/bin/python -B experiments/pdf-documents/export.py from the repository.
Pandoc is optional, for Word and standalone HTML. Existing KaTeX powers the preview.
"""
import copy
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'artifacts/pdf-document-trial'


def export():
    sample = json.loads((ROOT / 'experiments/pdf-documents/sample.json').read_text())
    bank = json.loads((ROOT / 'dist/data/bank.json').read_text())
    index = json.loads((ROOT / 'data/render-index.json').read_text())
    if sample['sourceBankRevision'] != bank['revision']:
        raise ValueError('题库版本已变更，请重新核对试样。')
    originals = {q['id']: q for q in bank['questions']}
    ids = [q['id'] for q in sample['questions']]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError('题目 ID 为空或重复。')
    converted, image_paths = [], set()
    for record in sample['questions']:
        if set(record) != {'id', 'stem', 'options', 'analysis'}:
            raise ValueError('转写仅允许覆盖题干、选项文字和解析。')
        original = originals[record['id']]
        if [o['id'] for o in record['options']] != [o['id'] for o in original['options']]:
            raise ValueError('选项顺序与原件不一致：' + record['id'])
        for text in [record['stem'], record['analysis']] + [o['text'] for o in record['options']]:
            if not text.strip() or '<' in re.sub(r'\$\$[\s\S]*?\$\$|\$[^$]*\$', '', text):
                raise ValueError('试样须为非空文字与 LaTeX。')
            if text.count('$') % 2:
                raise ValueError('公式分隔符不成对：' + record['id'])
        q = copy.deepcopy(original)
        q.update(record)
        q['searchText'] = q['sourceLabel'] + ' ' + record['stem']
        converted.append(q)
        old_html = original['stem'] + original['analysis'] + ''.join(o['text'] for o in original['options'])
        image_paths.update(ROOT / '_site/question-images' / path for path in re.findall(r'/api/question-image/([^?" ]+)', old_html))
    docs = {originals[qid]['source']['documentId'] for qid in ids}
    for did in docs:
        source = index['documents'][did]
        if hashlib.sha256((ROOT / source['path']).read_bytes()).hexdigest() != source['sha256']:
            raise ValueError('源 PDF 校验失败：' + did)
    missing = [str(p) for p in image_paths if not p.is_file()]
    if missing:
        raise ValueError('缺少用于比较的已构建题图：' + str(missing[:3]))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    deployment = {'format':'zhixing.question-documents.v1', 'sourceBankRevision':bank['revision'],
                  'reviewStatus':sample['reviewStatus'], 'questions':converted}
    compact = json.dumps(deployment, ensure_ascii=False, separators=(',', ':')).encode()
    (OUTPUT / 'questions.json').write_bytes(compact)
    md = ['# 知行学习：PDF 转文字文档试样', '',
          f'{len(converted)} 道题；助手视觉转写并核对，待人工复核。原题、选项顺序、答案和来源均保留。', '',
          '公式为可编辑 LaTeX；Word 导出为原生公式。此试样不表示已完成全量自动识别。', '']
    for q in converted:
        md += ['## ' + q['sourceLabel'], '', q['stem'], '']
        for option in q['options']:
            md += [f"{option['id']}. {option['text']}", '']
        md += ['**参考答案：** ' + str(q['answer']), '', '**原题解析：**', '', q['analysis'], '',
               f"来源：{q['source']['file']}，第 {q['source']['page']} 页；题号 `{q['id']}`。", '']
    md += ['## 转写核对说明', ''] + [f'- {note}' for note in sample['notes']]
    (OUTPUT / 'questions.md').write_text('\n'.join(md) + '\n', encoding='utf-8')
    articles = []
    def rich(text):
        return '<div class="rich" data-rich="' + html.escape(text, quote=True) + '"></div>'
    for q in converted:
        images = []
        for part in ['stem'] + ['option-' + o['id'] for o in q['options']] + ['analysis']:
            for number, clip in enumerate(index['questions'][q['id']]['parts'][part]):
                url = f"../../_site/question-images/{q['id']}/{part}/{number}.webp"
                images.append('<p>' + html.escape(part) + '</p><img loading="lazy" src="' + url + '" alt="原题核对图">')
        body = rich(q['stem']) + ''.join('<div class="option"><b>' + o['id'] + '.</b>' + rich(o['text']) + '</div>' for o in q['options'])
        body += '<p><b>参考答案：' + html.escape(str(q['answer'])) + '</b></p><h3>原题解析</h3>' + rich(q['analysis'])
        body += '<p class="source">' + html.escape(q['source']['file']) + ' · 第 ' + str(q['source']['page']) + ' 页</p>'
        articles.append('<article><h2>' + html.escape(q['sourceLabel']) + '</h2><section class="converted">' + body + '</section><details><summary>展开原题图片核对</summary>' + ''.join(images) + '</details></article>')
    preview = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>知行学习 · 文档转换试样</title>
<link rel="stylesheet" href="../../dist/vendor/katex/katex.min.css">
<style>body{font:16px/1.8 system-ui,sans-serif;color:#19332e;background:#f3f6f4;margin:0}main{max-width:1060px;margin:auto;padding:32px 24px}h1{font-size:28px}article{background:white;border:1px solid #dce4df;border-radius:16px;margin:24px 0;padding:24px}h2{font-size:20px;margin-top:0}.rich{overflow-x:auto;padding:4px 0}.option{display:flex;gap:16px;padding:6px 0;align-items:center;min-width:0}.option .rich{min-width:0}.source{font-size:12px;color:#65756e;overflow-wrap:anywhere}details{border-top:1px solid #ddd;margin-top:20px;padding-top:12px}summary{cursor:pointer;color:#217458}img{display:block;max-width:100%;height:auto}a{color:#217458}.katex{font-size:1.1em}.katex-display{overflow-x:auto;overflow-y:hidden}@media(max-width:500px){main{padding:16px 12px}article{padding:16px}h1{font-size:24px}}</style>
<main><h1>PDF 转文字文档：试样</h1><p>函数 · 极限 · 不定积分 · 矩阵</p><p>以下使用网站现有公式渲染器显示转写结果。助手视觉转写并核对，仍待人工复核。</p><p><a href="questions.docx">Word 文档</a> · <a href="questions.md">Markdown 源文档</a> · <a href="questions.json">结构化 JSON</a></p>''' + ''.join(articles) + '''</main>
<script src="../../dist/vendor/katex/katex.min.js"></script><script src="../../dist/vendor/katex/auto-render.min.js"></script>
<script type="module">import {renderRich} from '../../dist/rich-content.mjs';renderRich(document.body);window.trialReady=true;</script></html>'''
    (OUTPUT / 'preview.html').write_text(preview, encoding='utf-8')
    pandoc = shutil.which('pandoc')
    omml = None
    if pandoc:
        subprocess.run([pandoc, str(OUTPUT / 'questions.md'), '--standalone', '--mathml',
                        '--metadata=lang:zh-CN', '--metadata=title:知行学习题目文档试样',
                        '-o', str(OUTPUT / 'questions.html')], check=True)
        subprocess.run([pandoc, str(OUTPUT / 'questions.md'), '--from=markdown+tex_math_dollars',
                        '--metadata=lang:zh-CN', '-o', str(OUTPUT / 'questions.docx')], check=True)
        with ZipFile(OUTPUT / 'questions.docx') as archive:
            document = ET.fromstring(archive.read('word/document.xml'))
            omml = len(document.findall('.//{http://schemas.openxmlformats.org/officeDocument/2006/math}oMath'))
            if not omml or any(p.startswith('word/media/') for p in archive.namelist()):
                raise ValueError('Word 应包含原生公式，而非公式截图。')
    all_images = list((ROOT / '_site/question-images').rglob('*.webp'))
    image_bytes = sum(p.stat().st_size for p in image_paths)
    original_records = json.dumps([originals[qid] for qid in ids],ensure_ascii=False,separators=(',',':')).encode()
    stats = {'questions':len(converted), 'sourceDocuments':len(docs),
             'sampleImageFiles':len(image_paths), 'sampleImageBytes':image_bytes,
             'sampleOriginalRecordsBytes':len(original_records),
             'sampleOriginalRecordsAndImagesBytes':len(original_records)+image_bytes,
             'sampleDocumentJSONFiles':1,'sampleDocumentJSONBytes':len(compact),
             'sampleReductionPercent':round(100*(1-len(compact)/(len(original_records)+image_bytes)),2),
             'wordNativeFormulaCount':omml,
             'allQuestions':len(bank['questions']), 'allImageFiles':len(all_images),
             'allImageBytes':sum(p.stat().st_size for p in all_images),
             'allSourcePDFBytes':sum((ROOT/s['path']).stat().st_size for s in index['documents'].values()),
             'fileBytes':{name:(OUTPUT/name).stat().st_size for name in ['questions.json','questions.md','questions.html','questions.docx','preview.html'] if (OUTPUT/name).exists()},
             'limitations':['8-question sample; no geometry or cross-page content; no full-bank size projection.',
                            'Assistant visual transcription, not automatic formula OCR; human review pending.',
                            'JSON runtime format only; do not deploy all export formats together.',
                            'Original PDF bytes remain if published; relocating archives is a separate change.']}
    (OUTPUT / 'metrics.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    export()
