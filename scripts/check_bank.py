"""Read-only PDF intake report: registration, proposed chapter and exported counts."""
import argparse
import hashlib
import json
from pathlib import Path
import re

import fitz

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
    result = []
    for path in sorted((root / 'question-bank').rglob('*.pdf')):
        relative = path.relative_to(root)
        if '习概' in relative.parts:
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
            'questions': sum(r.get('questions', 0) for r in result)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    report = scan_sources()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        for row in report['files']:
            status = '错误' if row.get('error') else '已更改' if row.get('changed') else '已登记' if row['registered'] else '待登记'
            print(f"[{status}] {row['path']} · {row.get('questions', '?')} 题 · 章节：{row['chapterId'] or row['suggestedChapterId'] or '待指定'}")
            if row.get('error'):
                print('  ' + row['error'])
        for path in report['missing']:
            print('[文件缺失] ' + path)
        print(f"合计 {len(report['files'])} 份数学 PDF、{report['questions']} 题；待登记 {report['new']} 份，更改 {report['changed']} 份。")
    if report['new'] or report['changed'] or report['missing'] or any(r.get('error') for r in report['files']):
        raise SystemExit(1)
