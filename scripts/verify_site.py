"""Verify the complete static output, including every image reference and original."""
import hashlib
import base64
import io
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from PIL import Image
from study_sources import verify_sources

ROOT = Path(__file__).resolve().parents[1]


def verify():
    verify_sources(ROOT)
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
    if report.get('sourcePDFsIncluded', True):
        for did, source in index['documents'].items():
            assert hashlib.sha256((site / 'source-pdf' / f'{did}.pdf').read_bytes()).hexdigest() == source['sha256']
    else:
        assert not (site / 'source-pdf').exists()
        assert all(q['source']['url'].startswith('https://github.com/PilotMiku/KnowActAcademy/blob/') for q in bank['questions'])
    figure_refs = set()
    for question in bank['questions']:
        content = question['stem'] + question['analysis'] + ''.join(o['text'] for o in question['options'])
        figure_refs.update(re.findall(r'src="\./(question-figures/[a-f0-9]+\.webp)"', content))
    figures = {p.relative_to(site).as_posix() for p in (site / 'question-figures').glob('*.webp')}
    assert figure_refs == figures, f'题目插图缺失或多余：{figure_refs ^ figures}'
    for figure in figures:
        with Image.open(site / figure) as bitmap:bitmap.verify()
    chunk_figures = {}
    for path in (site / 'question-figures').glob('*.json'):
        if '-' in path.stem:assert hashlib.sha256(path.read_bytes()).hexdigest()[:16] == path.stem.split('-')[1]
        chunk = json.loads(path.read_text())
        assert chunk['format'] == 'zhixing.figure-chunk.v1'
        for fid, source in chunk['figures'].items():
            assert re.fullmatch(r'[a-f0-9]{24}', fid) and fid.startswith(path.stem.split('-')[0])
            assert source.startswith('data:image/webp;base64,')
            assert fid not in chunk_figures
            chunk_figures[fid] = source
    expected_figures = set()
    for question in bank['questions']:
        content = question['stem'] + question['analysis'] + ''.join(o['text'] for o in question['options'])
        for version, fid in re.findall(r'/api/question-figure/([a-f0-9]{16})/([a-f0-9]{24})', content):
            expected_figures.add(fid)
            chunk_path = site / 'question-figures' / f'{fid[:2]}-{version}.json'
            assert chunk_path.is_file()
    assert expected_figures == set(chunk_figures), '原题公式插图缺失或多余'
    for fid, source in chunk_figures.items():
        with Image.open(io.BytesIO(base64.b64decode(source.split(',', 1)[1], validate=True))) as bitmap:bitmap.verify()
    assert report.get('figures', 0) == len(figures) + len(chunk_figures)
    for source in knowledge['sources']:
        assert hashlib.sha256((site / 'knowledge-source' / f"{source['id']}.{source['type']}").read_bytes()).hexdigest() == source['sha256']
    assert report['images'] == len(actual)
    assert report['questions'] == len(bank['questions'])
    assert not (site / 'backend').exists()
    assert not list(site.rglob('*.sqlite3'))
    pdf_location = '随站点发布' if report.get('sourcePDFsIncluded', True) else '保留在仓库，通过来源链接查看'
    print(f"静态校验通过：{len(bank['questions'])} 道题，{len(chunk_figures) + len(figures)} 张共享插图，"
          f"{len(actual)} 张旧版题图；{len(index['documents'])} 份数学 PDF {pdf_location}，"
          f"{len(knowledge['sources'])} 份知识资料。")


if __name__ == '__main__':
    verify()
