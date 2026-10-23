"""Compare the original checkout with the pre-migration snapshot, without writing to it."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

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
    for name in ['data', 'question-bank', 'dist/data']:
        for path in (ROOT / name).rglob('*'):
            if path.is_file() and path.name != '.DS_Store':
                relative = path.relative_to(ROOT)
                if path.read_bytes() != (args.original / relative).read_bytes():
                    raise SystemExit('题库资料内容不一致：' + str(relative))
    print('原项目源码与原题资料 SHA-256 校验通过；新项目题库及知识资料与原项目逐字节一致。')
