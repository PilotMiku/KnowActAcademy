"""Recount question records and all chapter scopes without modifying the bank."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def count_records(questions):
    formats = Counter(q.get('source', {}).get('format') for q in questions)
    excluded = sum(bool(q.get('sourceIncomplete') or q.get('original', {}).get('sourceIncomplete'))
                   or q.get('answerVerified') is False for q in questions)
    return dict(total=len(questions), pdf=formats['pdf'], supplement=formats['html'],
                other=len(questions)-formats['pdf']-formats['html'], scorable=len(questions)-excluded)


def recount(bank):
    ids = [q['id'] for q in bank['questions']]
    if len(ids) != len(set(ids)):
        raise ValueError('题号重复，不能按条数作为题量')
    subjects, scopes = [], {}
    for subject in bank['subjects']:
        chapters = {}

        def visit(items, parent=None):
            for c in items:
                if c['id'] in chapters:
                    raise ValueError('同科目章节 ID 重复')
                chapters[c['id']] = dict(id=c['id'], name=c['name'], parentId=c.get('parentId') or parent)
                visit(c.get('children', []), c['id'])

        visit(subject['chapters'])
        if subject['id'] in scopes:
            raise ValueError('科目 ID 重复')
        scopes[subject['id']] = chapters
        subjects.append(dict(id=subject['id'], name=subject['name'], chapters=list(chapters.values())))
    direct, totals, by_subject = defaultdict(list), defaultdict(list), defaultdict(list)
    for q in bank['questions']:
        sid, cid = q['subjectId'], q['chapterId']
        chapters = scopes.get(sid, {})
        if cid not in chapters:
            raise ValueError('题目引用未知科目或章节：' + q['id'])
        by_subject[sid].append(q)
        direct[sid, cid].append(q)
        visited = set()
        while cid:
            if cid in visited or cid not in chapters:
                raise ValueError('章节层级有循环或缺少父章')
            visited.add(cid)
            totals[sid, cid].append(q)
            cid = chapters[cid]['parentId']
    for s in subjects:
        s['counts'] = count_records(by_subject[s['id']])
        for c in s['chapters']:
            c['counts'] = count_records(totals[s['id'], c['id']])
            c['directCount'] = len(direct[s['id'], c['id']])
        root_total = sum(c['counts']['total'] for c in s['chapters'] if not c['parentId'])
        if root_total != s['counts']['total']:
            raise ValueError('根章合计与科目题量不一致')
    return dict(format='zhixing.question-counts.v1', revision=bank['revision'],
                definition='每个题号计一条记录；父章包含全部后代，不与小节重复累加；未确认等价的相似题分别保留。',
                counts=count_records(bank['questions']), subjects=subjects)


def audit(root=ROOT):
    raw = (root / 'dist/data/bank.json').read_bytes()
    bank = json.loads(raw)
    result = recount(bank)
    result['bankSha256'] = hashlib.sha256(raw).hexdigest()
    original = json.loads((root / 'data/pdf-source-bank.json').read_text())
    original_ids = {q['id'] for q in original['questions']}
    ids = {q['id'] for q in bank['questions']}
    if not original_ids <= ids:
        raise ValueError('原始 PDF 题号有缺失')
    aliases = json.loads((root / 'data/questionbank-unification.json').read_text())['questionAliases']
    if not set(aliases.values()) <= ids:
        raise ValueError('补充资料题号映射有缺失')
    result['sources'] = dict(originalPdf=len(original_ids), supplementEntries=len(aliases),
                             supplementAdded=len(ids-original_ids),
                             previouslyMerged=len(original_ids)+len(aliases)-len(ids),
                             originalIdsPreserved=True)
    return result


def markdown(report):
    c, source = report['counts'], report['sources']
    lines = ['# 题量重算', '', f"题库版本：`{report['revision']}`。", '',
             report['definition'], '',
             f"全站 **{c['total']:,} 条题目记录**：原 PDF {source['originalPdf']:,} 条、补充新增 {source['supplementAdded']:,} 条。其中可评分 {c['scorable']:,} 条；待核实或缺损记录保留但不计评分。", '',
             f"来源对账：PDF {source['originalPdf']:,} + 补充资料原始 {source['supplementEntries']:,} − 既有确认合并 {source['previouslyMerged']:,} = {c['total']:,}。此次仅重新统计，没有删除或合并任何记录。", '',
             '这些数字是已保存记录数，不是已经完成数学等价核验的独立题目数。题号不同、来源不同不构成独立数学题的证明；相似文本也不构成重复题的证明。', '',
             '运行 `python3 scripts/count_questions.py` 可重算；`--check` 检查登记结果与当前题库一致。', '',
             '| 科目 / 章节 | 全部记录 | PDF | 补充新增 | 可评分 |',
             '| --- | ---: | ---: | ---: | ---: |']
    for s in report['subjects']:
        for name, c in [(s['name'], s['counts'])] + [(('↳ ' if ch['parentId'] else '')+ch['name'], ch['counts']) for ch in s['chapters']]:
            lines.append(f"| {name} | {c['total']} | {c['pdf']} | {c['supplement']} | {c['scorable']} |")
    return '\n'.join(lines)+'\n'


def check_report(root=ROOT):
    report = audit(root)
    if json.loads((root / 'data/question-counts.json').read_text()) != report:
        raise ValueError('题量登记过期，请运行 python3 scripts/count_questions.py')
    if (root / 'docs/QUESTION_COUNTS.md').read_text() != markdown(report):
        raise ValueError('章节题量文档过期，请运行 python3 scripts/count_questions.py')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    report = check_report() if args.check else audit()
    if not args.check:
        (ROOT / 'data/question-counts.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
        (ROOT / 'docs/QUESTION_COUNTS.md').write_text(markdown(report))
    print(json.dumps(dict(counts=report['counts'], sources=report['sources']), ensure_ascii=False))
