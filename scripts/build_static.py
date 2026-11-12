"""Build the complete GitHub Pages site without changing question-bank content."""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
import io
import json
import os
import re
from pathlib import Path
import shutil

import fitz
from PIL import Image, ImageDraw
from study_sources import verify_sources
from source_archives import verify_source
from pack_figures import pack_figures

ROOT = Path(__file__).resolve().parents[1]
SCALE = 2.5


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def render_document(job):
    document, questions, cache_path = job
    cache = Path(cache_path)
    count = 0
    with fitz.open(ROOT / document['path']) as pdf:
        for qid, question in questions:
            for part, clips in question['parts'].items():
                for number, clip in enumerate(clips):
                    target = cache / qid / part / f'{number}.webp'
                    if not target.exists():
                        pix = pdf[clip['page']].get_pixmap(
                            matrix=fitz.Matrix(SCALE, SCALE), clip=fitz.Rect(clip['rect']), alpha=False)
                        bitmap = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
                        draw = ImageDraw.Draw(bitmap)
                        for box in clip['hideAnswerLabels']:
                            # Same answer-label masking and raster origin as the original server.
                            draw.rectangle([(box[0]*SCALE-pix.x-2, box[1]*SCALE-pix.y-2),
                                            (box[2]*SCALE-pix.x+2, box[3]*SCALE-pix.y+2)], fill='white')
                        buffer = io.BytesIO()
                        bitmap.save(buffer, 'WEBP', lossless=True, method=4)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        temporary = target.with_suffix('.tmp')
                        temporary.write_bytes(buffer.getvalue())
                        temporary.replace(target)
                    count += 1
    return count


def build(workers=4):
    verify_sources(ROOT)
    destination, previous = ROOT / '_site', ROOT / '.previous-site'
    # Recover the last working site if a previous run was interrupted during promotion.
    if previous.exists() and not destination.exists():
        previous.replace(destination)
    elif previous.exists():
        shutil.rmtree(previous)
    index = json.loads((ROOT / 'data/render-index.json').read_text())
    bank = json.loads((ROOT / 'dist/data/bank.json').read_text())
    manifest = json.loads((ROOT / 'dist/data/manifest.json').read_text())
    knowledge = json.loads((ROOT / 'dist/data/knowledge.json').read_text())
    registry = json.loads((ROOT / 'data/knowledge-sources.json').read_text())
    native = bank.get('contentMode') == 'native'
    if bank['revision'] != manifest['revision'] or (bank.get('sourcePdfRevision') if native else bank['revision']) != index['revision']:
        raise ValueError('题库索引与题库版本不一致')
    if registry['revision'] != knowledge['revision']:
        raise ValueError('知识点索引与资料版本不一致')
    bank_ids = {q['id'] for q in bank['questions']}
    source_ids = set(index['questions'])
    if not source_ids <= bank_ids or (not native and source_ids != bank_ids):
        raise ValueError('题目索引不完整')
    sources = list(index['documents'].values()) + registry['sources']
    for source in sources:
        verify_source(ROOT, source['path'], source['sha256'])
    cache = ROOT / '.cache' / f"{index['revision']}-raster-v2"
    staging = ROOT / '.build'
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(ROOT / 'dist', staging, ignore=shutil.ignore_patterns('.DS_Store', 'Thumbs.db'))
    packed = pack_figures(ROOT / 'dist/question-figures', staging, bank)
    for path in (staging / 'question-figures').glob('*.json'):
        path.unlink()
    jobs = []
    referenced = set()
    for question in bank['questions']:
        content = question['stem'] + question['analysis'] + ''.join(o['text'] for o in question['options'])
        referenced.update(re.findall(r'/api/question-image/([a-z0-9-]+)/(stem|analysis|option-[A-H])/(\d+)\.webp', content))
    needed = {}
    for qid, part, number in referenced:
        if qid not in index['questions'] or part not in index['questions'][qid]['parts'] or int(number) >= len(index['questions'][qid]['parts'][part]):
            raise ValueError('原题截图引用无效：' + qid + '/' + part + '/' + number)
        needed.setdefault(qid, {'documentId': index['questions'][qid]['documentId'], 'parts': {}})['parts'][part] = index['questions'][qid]['parts'][part]
    for did, document in index['documents'].items():
        questions = [(qid, q) for qid, q in needed.items() if q['documentId'] == did]
        if questions:jobs.append((document, questions, str(cache)))
    image_count = 0
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(render_document, job) for job in jobs]
        for number, future in enumerate(as_completed(futures), 1):
            image_count += future.result()
            if number % 10 == 0 or number == len(jobs):
                print(f'题图生成：{number}/{len(jobs)} PDF，{image_count} 张', flush=True)
    images = staging / 'question-images'
    images.mkdir()
    # Copy only referenced clips, so removed questions never leak from the cache.
    for qid, part, number in referenced:
        relative = Path(qid) / part / f'{number}.webp'
        target = images / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(cache / relative, target)
    image_count = len(referenced)
    if not native:
        (staging / 'source-pdf').mkdir()
        for did, document in index['documents'].items():
            shutil.copyfile(ROOT / document['path'], staging / 'source-pdf' / f'{did}.pdf')
    else:
        for question in bank['questions']:
            if not question.get('source', {}).get('url', '').startswith('https://github.com/PilotMiku/KnowActAcademy/blob/'):
                raise ValueError('文字题库缺少原始资料链接：' + question['id'])
    (staging / 'knowledge-source').mkdir()
    for source in registry['sources']:
        shutil.copyfile(ROOT / source['path'], staging / 'knowledge-source' / f"{source['id']}.{source['type']}")
    (staging / '.nojekyll').touch()
    total = sum(p.stat().st_size for p in staging.rglob('*') if p.is_file())
    if total > 900 * 1024 * 1024:
        raise ValueError('静态网站超过 900 MiB，请拆分原始资料托管后再部署')
    report = {'name': '知行学习题库', 'revision': bank['revision'],
              'knowledgeRevision': knowledge['revision'], 'questions': len(bank['questions']),
              'images': image_count, 'documents': len(index['documents']),
              'sourcePDFsIncluded': not native,
              **packed,
              'figures': packed['figures'] + len(list((staging / 'question-figures').glob('*.webp'))),
              'knowledgeSources': len(registry['sources']), 'bytes': total,
              'bankSha256': sha256(ROOT / 'dist/data/bank.json'),
              'knowledgeSha256': sha256(ROOT / 'dist/data/knowledge.json')}
    (staging / 'build-manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    if destination.exists():
        destination.replace(previous)
    try:
        staging.replace(destination)
    except OSError:
        if previous.exists() and not destination.exists():
            previous.replace(destination)
        raise
    if previous.exists():
        shutil.rmtree(previous)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, default=min(4, os.cpu_count() or 1))
    args = parser.parse_args()
    if not 1 <= args.workers <= 16:
        parser.error('--workers must be between 1 and 16')
    build(args.workers)
