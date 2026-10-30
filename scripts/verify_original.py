"""Compare the original checkout with the pre-migration snapshot, without writing to it."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def compare_questions(original, expanded):
    current = {q['id']: q for q in expanded['questions']}
    def content(question):
        return re.sub(r'(?<=\.webp)\?v=pdf-[a-f0-9]+', '?v=REVISION',
                      json.dumps(question, ensure_ascii=False, sort_keys=True))
    for question in original['questions']:
        if question['id'] not in current or content(question) != content(current[question['id']]):
            raise ValueError('原题内容或题号发生变化：' + question['id'])


def compare_regions(original, expanded):
    for key in ['documents', 'questions']:
        for identity, record in original[key].items():
            if expanded[key].get(identity) != record:
                raise ValueError('原题资料或裁切区域发生变化：' + identity)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('original', type=Path)
    args = parser.parse_args()
    snapshot = json.loads((ROOT / 'docs/original-checksums.json').read_text())
    errors = []
    for name, expected in snapshot.items():
        if Path(name).name == '.DS_Store':
            continue  # Finder metadata is unrelated to source integrity.
        path = args.original / name
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            errors.append(name)
    if errors:
        raise SystemExit('原项目内容发生变化：' + ', '.join(errors))
    for name, expected in snapshot.items():
        if name.startswith('question-bank/') and Path(name).name != '.DS_Store':
            if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
                raise SystemExit('原始资料内容不一致：' + name)
    for name in ['dist/data/knowledge.json', 'data/knowledge-sources.json']:
        if (ROOT / name).read_bytes() != (args.original / name).read_bytes():
            raise SystemExit('知识资料内容不一致：' + name)
    try:
        compare_questions(json.loads((args.original / 'dist/data/bank.json').read_text()),
                          json.loads((ROOT / 'dist/data/bank.json').read_text()))
        compare_regions(json.loads((args.original / 'data/render-index.json').read_text()),
                        json.loads((ROOT / 'data/render-index.json').read_text()))
    except ValueError as error:
        raise SystemExit(str(error)) from error
    print('原项目 SHA-256 及全部旧题内容、题号、裁切区域校验通过；新增题目允许追加，资源版本允许更新。')
