"""Apply source-bound editorial reviews while retaining IDs and reference keys."""
import argparse
import copy
import hashlib
import html
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def records():
    return json.loads((ROOT / 'data/question-reviews.json').read_text())['entries']


def native(text):
    return '<p>' + html.escape(text).replace('\n', '<br>') + '</p>'


def apply_answer_review(question, row):
    reference = row['referenceAnswer']
    corrected = row.get('correctedAnswer', reference)
    if (question['source']['sha256'] != row['sourceSha256']
            or question['answer'] not in (reference, corrected)):
        raise ValueError('Editorial review no longer matches its source: ' + question['id'])
    if 'correctedAnswer' in row and not any(o['id'] == corrected for o in question['options']):
        raise ValueError('Corrected answer is not an option: ' + question['id'])
    question['answer'] = corrected


def apply_reviews(bank, reviews=None):
    questions = {q['id']: q for q in bank['questions']}
    for qid, row in (records() if reviews is None else reviews).items():
        q = questions[qid]
        apply_answer_review(q, row)
        for part, text in row.get('parts', {}).items():
            if part.startswith('option-'):
                next(o for o in q['options'] if o['id'] == part[7:])['text'] = native(text)
            else:
                q[part] = native(text)
        if row['assessment'] == 'review-only':
            q['answerVerified'] = False
        q['editorialReview'] = {'assessment': row['assessment'], 'reason': row['reason'],
                                'sourceSha256': row['sourceSha256']}
        q['searchText'] = re.sub(r'<[^>]+>', ' ', q['sourceLabel'] + ' ' + q['stem'])
    return bank


def apply_draft_reviews(bank, review, reviews=None):
    questions = {q['id']: q for q in bank['questions']}
    for qid, row in (records() if reviews is None else reviews).items():
        q = questions[qid]
        apply_answer_review(q, row)
        record = review[qid]
        for name, text in row.get('parts', {}).items():
            record['parts'][name] = {'text': text, 'status': 'source-checked', 'evidence': [],
                'manualReview': {'editorial': True, 'reviewMethod': row['method']}}
            if name.startswith('option-'):
                next(o for o in q['options'] if o['id'] == name[7:])['text'] = text
            else:
                q[name] = text
        if row['assessment'] == 'review-only':
            q['answerVerified'] = False
        record['status'] = 'source-checked' if all(p['status'] == 'source-checked' for p in record['parts'].values()) else 'review-required'


def publish(check=False):
    path = ROOT / 'dist/data/bank.json'
    original = json.loads(path.read_text())
    bank = apply_reviews(copy.deepcopy(original))
    if check:
        if bank != original:
            raise ValueError('Run python3 scripts/question_reviews.py to publish editorial reviews')
        return
    bank['revision'] = 'pdf-' + hashlib.sha256(json.dumps(bank['questions'], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    path.write_text(json.dumps(bank, ensure_ascii=False, separators=(',', ':')) + '\n')
    manifest = ROOT / 'dist/data/manifest.json'
    value = json.loads(manifest.read_text()); value['revision'] = bank['revision']
    manifest.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
    for name, key in [('data/supplement-sources.json', 'unifiedRevision'), ('data/questionbank-unification.json', 'revision')]:
        target = ROOT / name
        value = json.loads(target.read_text()); value[key] = bank['revision']
        target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'revision': bank['revision'], 'reviewed': len(records())}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    publish(parser.parse_args().check)
