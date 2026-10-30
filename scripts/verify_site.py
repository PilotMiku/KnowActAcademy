"""Verify the complete static output, including every image reference and original."""
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def verify():
    site = ROOT / '_site'
    bank = json.loads((ROOT / 'dist/data/bank.json').read_text())
    index = json.loads((ROOT / 'data/render-index.json').read_text())
    knowledge = json.loads((ROOT / 'data/knowledge-sources.json').read_text())
    report = json.loads((site / 'build-manifest.json').read_text())
    for source in (ROOT / 'dist').rglob('*'):
        if source.is_file():
            assert source.read_bytes() == (site / source.relative_to(ROOT / 'dist')).read_bytes(), source
    expected = set()
    for question in bank['questions']:
        html = question['stem'] + question['analysis'] + ''.join(o['text'] for o in question['options'])
        for raw in re.findall(r'src="(/api/question-image/[^"]+)"', html):
            path = urlsplit(raw).path.replace('/api/question-image/', 'question-images/', 1)
            expected.add(path)
    actual = {p.relative_to(site).as_posix() for p in (site / 'question-images').rglob('*.webp')}
    assert expected == actual, f'题图缺失或多余：{expected ^ actual}'
    for path in sorted(actual):
        with Image.open(site / path) as bitmap:
            assert bitmap.width > 0 and bitmap.height > 0
            bitmap.verify()
    for did, source in index['documents'].items():
        assert hashlib.sha256((site / 'source-pdf' / f'{did}.pdf').read_bytes()).hexdigest() == source['sha256']
    for source in knowledge['sources']:
        assert hashlib.sha256((site / 'knowledge-source' / f"{source['id']}.{source['type']}").read_bytes()).hexdigest() == source['sha256']
    assert report['images'] == len(actual)
    assert report['questions'] == len(bank['questions'])
    assert not (site / 'backend').exists()
    assert not list(site.rglob('*.sqlite3'))
    print(f"静态校验通过：{len(bank['questions'])} 道题，{len(actual)} 张有效题图，{len(index['documents'])} 份数学 PDF，{len(knowledge['sources'])} 份知识资料。")


if __name__ == '__main__':
    verify()
