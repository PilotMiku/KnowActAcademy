"""Scan every question and record evidence without certifying unsolved maths."""
import collections
import hashlib
import json
from pathlib import Path
import re

from question_reviews import records, apply_draft_reviews
from supplemental_analysis import entries as supplemental_entries, review_required

ROOT = Path(__file__).resolve().parents[1]


def read(name, default=None):
    path = ROOT / name
    return json.loads(path.read_text()) if path.exists() else default


def chinese(text):
    return collections.Counter(re.findall(r'[\u3400-\u9fff]', re.sub(r'<[^>]+>', '', text)))


def scan():
    raw = (ROOT / 'dist/data/bank.json').read_bytes()
    bank = json.loads(raw)
    originals = {q['id']: q for q in read('data/pdf-source-bank.json')['questions']}
    review_data = read('data/question-reviews.json')
    reviews = review_data['entries']
    duplicate_reviews = review_data.get('duplicateOptionScreening', {})
    supplemental = supplemental_entries()
    math = read('artifacts/question-math-screening.json', {})
    if math and math.get('bankRevision') != bank['revision']:
        raise ValueError('Symbolic screening is stale; rerun experiments/pdf-documents/audit_math.py')
    math_rows = {row['questionId']: row for row in math.get('questions', [])}
    draft_review = read('artifacts/pdf-transcription/unified-review.json', {}).get('questions', {})
    # Apply the same source-bound corrections used by the website and export.
    if draft_review:
        draft = read('artifacts/pdf-transcription/unified-native-draft.json')
        apply_draft_reviews(draft, draft_review, reviews)
    source_segments = {}
    segments_path = ROOT / '.cache/supplement-transcription/segments.jsonl'
    if segments_path.exists():
        for line in segments_path.open():
            row = json.loads(line); source_segments[row['id']] = row
    rows = []
    for q in bank['questions']:
        issues = []
        option_ids = [o['id'] for o in q['options']]
        if not q['stem'].strip(): issues.append('empty-stem')
        if len(option_ids) != len(set(option_ids)) or len(option_ids) != 4: issues.append('invalid-option-structure')
        if any(not o['text'].strip() for o in q['options']): issues.append('empty-option')
        if q['answer'] not in option_ids: issues.append('answer-not-an-option')
        if q['id'] in originals:
            expected = originals[q['id']]['answer']
        else:
            index = q['source'].get('answerEvidence', {}).get('greenOption')
            expected = option_ids[index] if isinstance(index, int) and 0 <= index < len(option_ids) else None
        key_status = 'matches-primary-source' if expected == q['answer'] else 'source-key-unavailable' if expected is None else 'source-key-mismatch'
        if key_status != 'matches-primary-source': issues.append(key_status)
        source = draft_review.get(q['id'], {})
        stem_review = source.get('parts', {}).get('stem', {})
        segment = source_segments.get(stem_review.get('sourceImageId'))
        prose = 'not-applicable-or-not-available'
        if q['id'] in reviews and 'stem' in reviews[q['id']].get('parts', {}):
            prose = 'visually-restored'
        elif stem_review.get('manualReview'):
            prose = 'previous-visual-source-review'
        elif segment and 'data-kind="figure"' not in q['stem']:
            text = ''.join(n['text'] for n in segment['nodes'] if n['kind'] == 'text')
            missing = chinese(text) - chinese(q['stem'])
            prose = 'candidate-loss' if sum(missing.values()) >= 2 else 'no-dropped-chinese-prose-detected'
            if prose == 'candidate-loss': issues.append('possible-dropped-source-prose')
        elif 'data-kind="figure"' in q['stem']:
            prose = 'original-whole-part-image-retained'
        elif q['id'] in originals:
            prose = 'pdf-native-prose-or-reviewed-correction'
        excluded = bool(q.get('sourceIncomplete') or q.get('answerVerified') is False or review_required(q, supplemental))
        if q.get('sourceIncomplete'): issues.append('known-source-incomplete')
        editorial = reviews.get(q['id'])
        math_status = 'not-independently-recomputed'
        if editorial and editorial['assessment'] == 'review-only':
            math_status = 'confirmed-source-defect'; issues.append(editorial['kind'])
        elif editorial and 'analysis' in editorial.get('parts', {}):
            math_status = 'independently-reviewed-derivation'
        elif q['id'] in supplemental and supplemental[q['id']]['status'] == 'verified':
            math_status = 'previous-authored-derivation'
        elif math_rows.get(q['id'], {}).get('status') == 'matches-draft-answer':
            math_status = 'symbolic-result-matches-draft'
        elif excluded:
            math_status = 'prior-review-only'
        row = {'questionId': q['id'], 'label': q['sourceLabel'], 'scanned': True,
               'referenceAnswer': q['answer'], 'sourceKey': key_status, 'stemProse': prose,
               'sourceTranscription': source.get('status', 'review-evidence-unavailable'),
               'mathematics': math_status, 'scorable': not excluded, 'issues': issues}
        if q['id'] in duplicate_reviews: row['duplicateOptionScreening'] = duplicate_reviews[q['id']]['status']
        if math_rows.get(q['id'], {}).get('status') not in (None, 'unsupported', 'abstained'):
            row['symbolicScreening'] = math_rows[q['id']]
        rows.append(row)
    assert len(rows) == len({r['questionId'] for r in rows}) == len(bank['questions'])
    counts = collections.Counter(r['mathematics'] for r in rows)
    summary = {'recordsScanned': len(rows), 'primarySourceKeysMatched': sum(r['sourceKey'] == 'matches-primary-source' for r in rows),
               'emptyStems': sum('empty-stem' in r['issues'] for r in rows),
               'emptyOptions': sum('empty-option' in r['issues'] for r in rows),
               'newEditorialReviews': len(reviews),
               'restoredStems': sum(r['kind'].startswith('restored-stem') for r in reviews.values()),
               'newReviewOnly': sum(r['assessment'] == 'review-only' for r in reviews.values()),
               'totalReviewOnly': sum(not r['scorable'] for r in rows),
               'scorable': sum(r['scorable'] for r in rows), 'mathematicalEvidence': dict(counts),
               'duplicateOptionCandidatesVisuallyReviewed': len(duplicate_reviews),
               'remainingProseLossCandidates': sum('possible-dropped-source-prose' in r['issues'] for r in rows)}
    return {'format': 'zhixing.question-audit.v1', 'updated': review_data['updated'], 'revision': bank['revision'],
            'bankSha256': hashlib.sha256(raw).hexdigest(),
            'scope': 'All question IDs scanned for stem/option structure, recorded primary-source answer keys, source prose loss, answer/analysis letter conflicts and draft duplicate options; supported scalar limits/integrals additionally recomputed.',
            'limitations': ['A matching historical key is not proof of mathematical correctness.',
                           'No-warning and valid-rendering records are not certified correct.',
                           'Symbolic screening checks a restricted OCR-draft subset, may abstain and never changes grading automatically.',
                           'Questions without an independent derivation remain explicitly unverified; this is not an 8,425-question mathematical certification.'],
            'summary': summary, 'questions': rows}


def markdown(report):
    summary = report['summary']; reviews = records()
    lines = ['# 题库逐题扫描报告', '', f"审计记录更新于 {report['updated']}。题库版本 `{report['revision']}`。", '',
             f"已扫描全部 **{summary['recordsScanned']:,} 道题**，逐题结果保存在 `data/question-audit.json`。", '',
             '**全量扫描不等于全部数学答案已经独立证明正确。** 历史参考字母匹配、公式可渲染、未触发规则，均不能作为数学正确性的证明。尚未独立复算的题目在逐题记录中明确标为 `not-independently-recomputed`。', '',
             '| 检查 / 处理 | 数量 |', '| --- | ---: |',
             f"| 逐条扫描的题号 | {summary['recordsScanned']} |",
             f"| 与原记录的主来源参考字母一致 | {summary['primarySourceKeysMatched']} |",
             f"| 恢复缺失区间 / 所求内容的题干（含最初的 3.5 第 23 题） | {summary['restoredStems']} |",
             '| 按当前选项重新推导并纠正解析字母 | 20 |',
             f"| 补写简略解析或替换解析中的公式错误信息 | {sum(r['kind'] == 'expanded-analysis' for r in reviews.values())} |",
             f"| 本轮新确认有评分问题，改为仅供查阅 | {summary['newReviewOnly']} |",
             f"| 全站仅供查阅（含此前已标记） | {summary['totalReviewOnly']} |",
             f"| 当前可评分 | {summary['scorable']} |",
             f"| 已逐项查看原图的重复选项候选 | {summary['duplicateOptionCandidatesVisuallyReviewed']} |",
             f"| 源文字对照后仍待处理的题干中文遗漏预警 | {summary['remainingProseLossCandidates']} |", '',
             '原题号、所有题目记录、原参考字母、原件链接及来源摘要均保留。新确认有问题的题退出考试、备考和掌握度统计；题后写明计算结果和停用原因。没有凭自动规则修改答案。', '',
             '## 新确认的评分问题', '', '| 题目 | 原参考 | 问题 |', '| --- | --- | --- |']
    names = {'duplicate-correct-options': '两个相同的正确选项', 'duplicate-reference-options': '参考选项与另一个选项重复，边界条件仍须核实',
             'multiple-correct-options': '多个正确选项', 'no-correct-option': '没有正确选项', 'incorrect-reference-answer': '参考答案与现存题干不符'}
    for qid, row in reviews.items():
        if row['assessment'] == 'review-only':
            lines.append(f"| {row['sourceLabel']}（`{qid}`） | {row['referenceAnswer']} | {names.get(row['kind'], row['kind'])} |")
    lines += ['', '## 独立数学证据的覆盖', '', '| 证据状态 | 题量 |', '| --- | ---: |']
    for name, count in summary['mathematicalEvidence'].items(): lines.append(f'| `{name}` | {count} |')
    lines += ['', '其中 `symbolic-result-matches-draft` 只表示受限符号计算与文字候选一致，仍可能需要核对原图。`previous-authored-derivation` 指此前保存的补充推导，和本轮重新求解分开统计。', '',
              '重新执行：`python3 scripts/audit_questions.py`。符号筛查需本地 SymPy 和 ANTLR4 环境，运行 `experiments/pdf-documents/audit_math.py`；来源文字比对使用本机保留的原图分割与转写证据。普通静态构建只校验已发布的编辑记录，无需 OCR 环境。', '',
              '人工核对与更正依据保存在 `data/question-reviews.json`。`scripts/question_reviews.py` 将更正写入正式题库，网站构建检查两者一致；Markdown 导出和 OCR 重建也使用同一份编辑记录。']
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    report = scan()
    (ROOT / 'data/question-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    (ROOT / 'docs/QUESTION_AUDIT.md').write_text(markdown(report))
    print(json.dumps(report['summary'], ensure_ascii=False, indent=2))
