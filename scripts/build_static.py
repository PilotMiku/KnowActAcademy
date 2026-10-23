"""Build the complete GitHub Pages site without changing question-bank content."""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
import io
import json
import os
from pathlib import Path
import shutil

import fitz
from PIL import Image, ImageDraw

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
    if not index['revision'] == bank['revision'] == manifest['revision']:
        raise ValueError('题库索引与题库版本不一致')
    if registry['revision'] != knowledge['revision']:
        raise ValueError('知识点索引与资料版本不一致')
    if set(index['questions']) != {q['id'] for q in bank['questions']}:
        raise ValueError('题目索引不完整')
    sources = list(index['documents'].values()) + registry['sources']
    for source in sources:
        if sha256(ROOT / source['path']) != source['sha256']:
            raise ValueError(f"原始资料校验失败：{source['path']}")
    cache = ROOT / '.cache' / f"{index['revision']}-raster-v2"
    staging = ROOT / '.build'
    if staging.exists():
        shutil.rmtree(staging)
    shutil.copytree(ROOT / 'dist', staging)
    jobs = []
    for did, document in index['documents'].items():
        jobs.append((document, [(qid, q) for qid, q in index['questions'].items()
                                if q['documentId'] == did], str(cache)))
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
    for qid, question in index['questions'].items():
        for part, clips in question['parts'].items():
            for number in range(len(clips)):
                relative = Path(qid) / part / f'{number}.webp'
                target = images / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(cache / relative, target)
    (staging / 'source-pdf').mkdir()
    for did, document in index['documents'].items():
        shutil.copyfile(ROOT / document['path'], staging / 'source-pdf' / f'{did}.pdf')
    (staging / 'knowledge-source').mkdir()
    for source in registry['sources']:
        shutil.copyfile(ROOT / source['path'], staging / 'knowledge-source' / f"{source['id']}.{source['type']}")
    (staging / '.nojekyll').touch()
    total = sum(p.stat().st_size for p in staging.rglob('*') if p.is_file())
    if total > 900 * 1024 * 1024:
        raise ValueError('静态网站超过 900 MiB，请拆分原始资料托管后再部署')
    report = {'name': '知行学习题库', 'revision': index['revision'],
              'knowledgeRevision': knowledge['revision'], 'questions': len(bank['questions']),
              'images': image_count, 'documents': len(index['documents']),
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
