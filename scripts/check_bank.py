"""Read-only intake checks for math exports and study materials."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

import fitz
from study_sources import source_report, source_files, load_materials

ROOT = Path(__file__).resolve().parents[1]


def suggested_chapter(path):
    if '线性代数' not in path.parts:
        return None
    name = path.stem
    if re.search('线性方程组|基础解系', name):
        return 'linear-chapter-6'
    if re.search('线性空间|线性变换|欧几里得', name):
        return 'linear-chapter-7'
    if re.search('向量|内积|正交', name):
        return 'linear-chapter-3'
    return None


def scan_sources(root=ROOT):
    root = Path(root)
    catalog = json.loads((root / 'data/catalog.json').read_text())
    registered = {d['path']: (s['id'], c['id']) for s in catalog['subjects']
                  for c in s['chapters'] for d in c['documents']}
    inventory = root / 'data/pdf-inventory.json'
    hashes = {d['path']: d['sha256'] for d in json.loads(inventory.read_text())} if inventory.exists() else {}
    study_registry = root / 'data/knowledge-sources.json'
    study_sources = json.loads(study_registry.read_text())['sources'] if study_registry.exists() else []
    study_paths = {s['path'] for s in study_sources}
    materials = load_materials(root)
    study_paths.update(m['path'] for m in materials)
    result = []
    for path in source_files(root):
        relative = path.relative_to(root)
        if (path.suffix.lower() != '.pdf' or '习概' in relative.parts or relative.as_posix() in study_paths
                or (relative.as_posix() not in registered and not {'高等数学', '线性代数'}.intersection(relative.parts))):
            continue
        name = relative.as_posix()
        row = {'path': name, 'registered': name in registered,
               'subjectId': registered.get(name, (None, None))[0],
               'chapterId': registered.get(name, (None, None))[1],
               'suggestedChapterId': suggested_chapter(relative)}
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            with fitz.open(path) as document:
                match = re.search(r'共\s*(\d+)\s*道题', document[0].get_text())
                if not match:
                    raise ValueError('未找到 NeuMathe 导出题量，需检查资料格式')
                row.update(pages=len(document), questions=int(match[1]), sha256=digest,
                           changed=name in hashes and digest != hashes[name])
        except Exception as error:
            row['error'] = str(error)
        result.append(row)
    found = {r['path'] for r in result}
    return {'files': result, 'missing': sorted(set(registered) - found),
            'new': sum(not r['registered'] for r in result),
            'changed': sum(r.get('changed', False) for r in result),
            'questions': sum(r.get('questions', 0) for r in result),
            'materials': materials,
            'studyFiles': study_sources,
            'studyTypes': dict(Counter(s['type'] for s in study_sources)),
            'sources': source_report(root)}


def has_issues(report):
    return bool(report['new'] or report['changed'] or report['missing'] or
                any(report['sources'].values()) or any(r.get('error') for r in report['files']))


def print_report(report, verbose=False):
    math_paths = {r['path'] for r in report['files']}
    for row in report['files']:
        if not verbose and row['registered'] and not row.get('changed') and not row.get('error'):
            continue
        status = '错误' if row.get('error') else '已更改' if row.get('changed') else '已登记' if row['registered'] else '待登记'
        print(f"[{status}] {row['path']} · {row.get('questions', '?')} 题 · 章节：{row['chapterId'] or row['suggestedChapterId'] or '待指定'}")
        if row.get('error'):
            print('  ' + row['error'])
        elif row.get('changed') or not row['registered']:
            print('  核对 data/catalog.json 后运行 python scripts/index_pdf_bank.py')
    for path in report['missing']:
        print('[数学文件缺失] ' + path)
    planned = {m['path'] for m in report['materials']}
    unsupported = set(report['sources']['unsupported'])
    for path in report['sources']['unregistered']:
        if path in math_paths or path in unsupported:
            continue
        if path in planned or path.startswith('question-bank/习概/'):
            print('[待生成索引] ' + path)
            print('  运行 python scripts/index_knowledge.py')
        else:
            print('[学习资料待登记] ' + path)
            print('  在 data/study-materials.json 填写 path 和 category，再运行 python scripts/index_knowledge.py')
    for path in sorted(unsupported):
        print('[格式不支持] ' + path + '；支持 PDF、Markdown、DOCX 和 TXT')
    for path in report['sources']['changed']:
        print('[资料已更改] ' + path)
        print('  核对改动后运行 python scripts/index_knowledge.py')
    for path in report['sources']['missing']:
        if path not in report['missing']:
            print('[资料缺失] ' + path + '；恢复原文件或核对资料登记表后重新生成索引')
    if verbose:
        categories = {m['path']: m['category'] for m in report['materials']}
        for source in report['studyFiles']:
            print(f"[资料索引] {source['path']} · {categories.get(source['path'], '习概笔记')} · {source['id']}")
    types = report['studyTypes']
    labels = {'pdf': 'PDF', 'md': 'Markdown', 'docx': 'Word', 'txt': 'TXT'}
    print(f"数学题库：{len(report['files'])} 份 PDF、{report['questions']} 题；待登记 {report['new']} 份，更改 {report['changed']} 份。")
    print(f"学习资料：{sum(types.values())} 份已索引原文件（" + '、'.join(f'{labels.get(k, k)} {v}' for k, v in sorted(types.items())) + '）。')
    print('检查未通过，请按以上提示处理。' if has_issues(report) else '检查通过，全部原始资料已登记且与索引一致。')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--verbose', action='store_true', help='显示全部数学 PDF 的逐文件结果')
    args = parser.parse_args()
    try:
        report = scan_sources()
    except (ValueError, OSError, KeyError) as error:
        if args.json:
            print(json.dumps({'error': str(error)}, ensure_ascii=False))
        else:
            print('资料检查失败：' + str(error))
        raise SystemExit(1)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_report(report, args.verbose)
    if has_issues(report):
        raise SystemExit(1)
