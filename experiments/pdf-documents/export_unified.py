"""Export every unified question to chapter documents and an explicit OCR draft.

Word uses native equations for checked LaTeX and the original source image for
unconfirmed expressions. The separate all-text Markdown is a review draft.
Neither export is copied into the Pages site.
"""
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import csv
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
TRANSCRIPTION = ROOT / 'artifacts/pdf-transcription'
OUTPUT = ROOT / 'artifacts/统一题库文档'
MEDIA = ROOT / '.cache/document-export/media'


class Markdown(HTMLParser):
    def __init__(self, images):
        super().__init__(convert_charrefs=True)
        self.images = images
        self.fragments = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag in ('p', 'div', 'details', 'summary'):
            self.fragments.append('\n\n')
        elif tag == 'br':
            self.fragments.append('  \n')
        elif tag == 'img':
            match = re.fullmatch(r'/api/question-figure/[a-f0-9]{16}/([a-f0-9]{24})', attrs['src'])
            if not match:
                raise ValueError('Unsupported export image: ' + attrs['src'])
            path, (width, height) = self.images[match[1]]
            if attrs.get('data-kind') == 'formula' and attrs.get('data-height'):
                inches = float(attrs['data-height']) / 6
                inches = min(inches, 6 * height / width)
                size = f'height={inches:.4f}in'
            else:
                size = f'width={min(6, width / 144):.4f}in'
            self.fragments.append(f'![原式]({path.as_posix()}){{{size}}}')

    def handle_endtag(self, tag):
        if tag in ('p', 'div', 'details', 'summary'):
            self.fragments.append('\n\n')

    def handle_data(self, value):
        self.fragments.append(value)


def convert(text, images):
    parser = Markdown(images)
    parser.feed(text)
    return ''.join(parser.fragments).strip()


def word_tex(text):
    """Replace layout-only TeX and equivalent aliases supported by Word."""
    def expression(match):
        value = match[1]
        value = re.sub(r'\\cfrac\b\s*(?:\[[lr]\])?', r'\\frac ', value)
        value = re.sub(r'\\intop\b', r'\\int', value)
        value = re.sub(r'\\space\b', r'\\,', value)
        value = re.sub(r'\\smash\b\s*(?:\[[tb]\])?', '', value)
        value = re.sub(r'\\(?:small|tiny|large|Large|scriptsize|footnotesize)\b', '', value)
        value = re.sub(r'\{\s*\\bf\s+([^{}]*)\}', lambda m: r'\mathbf{' + m[1] + '}', value)
        value = re.sub(r'\\bf\s*(~|(?=\}))', r'\1', value)
        # These source rules have zero width: they only enlarge empty blanks.
        value = re.sub(r'\\rule\s*\{\s*0\s*cm\s*\}\s*\{[^{}]*\}', '', value)
        # Invisible alignment tokens must disappear with their argument.
        while True:
            phantom = re.search(r'\\hphantom\b\s*', value)
            if not phantom:
                break
            start = phantom.end()
            if value[start:start+1] == '{':
                depth, end = 1, start + 1
                while depth and end < len(value):
                    if value[end] == '{': depth += 1
                    elif value[end] == '}': depth -= 1
                    end += 1
            else:
                token = re.match(r'\\[a-zA-Z]+|.', value[start:])
                end = start + len(token[0]) if token else start
            value = value[:phantom.start()] + value[end:]
        return r'\(' + value + r'\)'
    return re.sub(r'\\\(([\s\S]*?)\\\)', expression, text)


def export():
    if not shutil.which('pandoc'):
        raise RuntimeError('Full Word export needs pandoc')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    MEDIA.mkdir(parents=True, exist_ok=True)
    bank = json.loads((ROOT / 'dist/data/bank.json').read_text())
    draft = json.loads((TRANSCRIPTION / 'unified-native-draft.json').read_text())
    drafts = {q['id']: q for q in draft['questions']}
    review = json.loads((TRANSCRIPTION / 'unified-review.json').read_text())['questions']
    site_report = json.loads((TRANSCRIPTION / 'native-site-report.json').read_text())
    unification = json.loads((TRANSCRIPTION / 'unification-report.json').read_text())
    images = {}
    for chunk_path in sorted((ROOT / 'dist/question-figures').glob('*.json')):
        chunk = json.loads(chunk_path.read_text())
        for fid, uri in chunk['figures'].items():
            path = MEDIA / (fid + '.png')
            with Image.open(io.BytesIO(base64.b64decode(uri.split(',', 1)[1]))) as bitmap:
                size = bitmap.size
                if not path.exists():
                    bitmap.convert('RGB').save(path, optimize=True)
            images[fid] = (path, size)
    print(f'Prepared {len(images)} source images', flush=True)
    jobs = []
    for subject in bank['subjects']:
        for chapter in subject['chapters']:
            sections = {child['id'] for child in chapter.get('children', [])} | {chapter['id']}
            questions = [q for q in bank['questions'] if q['subjectId'] == subject['id'] and q['chapterId'] in sections]
            name = re.sub(r'[/\\:*?"<>|]', '_', subject['name'] + '-' + chapter['name'])
            header = ['# ' + subject['name'] + ' · ' + chapter['name'], '',
                      f'共 {len(questions)} 题；题库版本 {bank["revision"]}。', '',
                      '已核对公式转换为可编辑公式；未可靠确认的公式和图形保留原始图像。'
                      '这份文档不表示全部题目已经人工复核。', '']
            safe = header.copy()
            candidate = header[:4] + ['这是全量文字与 LaTeX 校对稿。含未通过检查的 OCR 候选；'
                                      '请按照每部分状态对照原件，勿作为定稿答案使用。', '']
            for number, q in enumerate(questions, 1):
                title = f'## {number}. {q["sourceLabel"]}'
                safe += [title, '', convert(q['stem'], images), '']
                for option in q['options']:
                    safe += [f'**{option["id"]}.** ' + convert(option['text'], images), '']
                safe += ['**答案：** ' + str(q['answer']), '', '**解析：**', '', convert(q['analysis'], images), '',
                         f'题目 ID：`{q["id"]}`；[原始资料]({q["source"]["url"]})。', '']
                raw = drafts[q['id']]
                parts = review[q['id']]['parts']
                candidate += [title, '', f'题目 ID：`{q["id"]}`。', '']
                for key, label in [('stem', '题干')] + [('option-' + o['id'], o['id']) for o in raw['options']] + [('analysis', '解析')]:
                    part = parts.get(key, {})
                    candidate += [f'**{label} [{part.get("status", "missing")}]**', '', part.get('text', '') or '原始资料未提供可用解析。', '']
                candidate += ['**答案：** ' + str(q['answer']), '', f'[原始资料]({q["source"]["url"]})', '']
            md = OUTPUT / (name + '.md')
            md.write_text(word_tex('\n'.join(safe)) + '\n')
            (OUTPUT / (name + '-文字LaTeX校对稿.md')).write_text('\n'.join(candidate) + '\n')
            jobs.append((md, OUTPUT / (name + '.docx'), len(questions)))

    def word(job):
        md, docx, count = job
        result = subprocess.run(['pandoc', str(md), '--from=markdown+tex_math_single_backslash-implicit_figures',
                                 '--metadata=lang:zh-CN', '-o', str(docx)], capture_output=True, text=True, check=True)
        (OUTPUT / (docx.stem + '-导出日志.txt')).write_text(result.stderr)
        if 'Could not convert TeX math' in result.stderr:
            raise ValueError('Word cannot render an equation; inspect ' + docx.stem + '-导出日志.txt')
        with ZipFile(docx) as archive:
            document = ET.fromstring(archive.read('word/document.xml'))
            equations = len(document.findall('.//{http://schemas.openxmlformats.org/officeDocument/2006/math}oMath'))
            media = [n for n in archive.namelist() if n.startswith('word/media/')]
            texts = ''.join(document.itertext())
            # Every question's ID must survive the actual Word conversion.
            ids = re.findall(r'题目 ID：`([^`]+)`', md.read_text())
            if len(ids) != count or any(qid not in texts for qid in ids):
                raise ValueError('Word lost question records: ' + docx.name)
        return {'file': docx.name, 'questions': count, 'nativeWordEquations': equations,
                'embeddedImages': len(media), 'warnings': result.stderr.count('[WARNING]'), 'bytes': docx.stat().st_size}

    results = []
    with ThreadPoolExecutor(max_workers=3) as executor:
        for future in as_completed([executor.submit(word, job) for job in jobs]):
            row = future.result(); results.append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
    with (OUTPUT / '逐题校对清单.csv').open('w', newline='', encoding='utf-8-sig') as handle:
        writer = csv.writer(handle)
        fields = ['题目ID', '科目', '章节', '全部转写已校验', '可编辑公式数', '保留原式数', '整块PDF原图数', '整块补充原图数', '缺少解析', '原题题干或选项缺损', '待校对部分', '原始资料']
        writer.writerow(fields)
        for q in bank['questions']:
            stats = site_report['questions'][q['id']]
            pending = [k for k, p in review[q['id']]['parts'].items() if p['status'] != 'source-checked']
            writer.writerow([q['id'], q['subjectId'], q['chapterId'], not pending,
                             stats.get('nativeFormulaOccurrences', 0), stats.get('preservedFormulaOccurrences', 0),
                             stats.get('preservedWholePdfParts', 0), stats.get('preservedWholeRasterParts', 0),
                             q.get('analysisMissing', False), q.get('sourceIncomplete', False), '；'.join(pending), q['source']['url']])
    summary = {'revision': bank['revision'], 'questions': len(bank['questions']),
               'documents': sorted(results, key=lambda row: row['file']),
               'nativeWordEquations': sum(r['nativeWordEquations'] for r in results),
               'warnings': sum(r['warnings'] for r in results),
               'mathConversionFailures': 0,
               'warningNote': 'Pandoc may warn about missing Chinese UI-label translations; math conversion failures abort the export.',
               'unification': unification['summary'], 'site': site_report['summary']}
    (OUTPUT / '导出统计.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    readme = ('知行学习统一题库\n\n'
              '17 份 Word 按高数十章、线代七章整理。已检查的公式为 Word 原生公式，'
              '未可靠确认的表达式和图形使用原始图像，不会用未经检查的 OCR 替换题意。\n'
              '“文字LaTeX校对稿.md”是全量文字候选，按部分标出状态；review-required、'
              'ocr-truncated、source-image-missing 等均需要复核，不能当作完成的定稿。\n'
              '逐题校对清单.csv 覆盖所有题目，可筛选尚需处理的部分。原始 PDF/HTML 保留于项目。\n'
              f'仍有 {site_report["summary"].get("sourceIncompleteQuestions", 0)} 题的题干或选项原图缺损，'
              f'{site_report["summary"]["missingAnalyses"]} 题缺少可用主解析，均有提示。\n'
              '网页题库与文档的图片保留策略一致。全部题目的 ID 均在导出的 Word XML 中逐一校验。\n')
    (OUTPUT / '阅读说明.txt').write_text(readme)
    archive_path = ROOT / 'artifacts/知行学习-统一题库文档.zip'
    with ZipFile(archive_path, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
        for path in OUTPUT.iterdir():
            if path.suffix == '.docx' or path.name.endswith('文字LaTeX校对稿.md') or path.name in ('阅读说明.txt', '逐题校对清单.csv', '导出统计.json'):
                archive.write(path, path.name)
    print(json.dumps({'archive': str(archive_path), 'bytes': archive_path.stat().st_size,
                      'documents': len(results), 'questions': summary['questions'],
                      'nativeWordEquations': summary['nativeWordEquations'], 'warnings': summary['warnings']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    export()
