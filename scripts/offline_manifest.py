"""Describe versioned, explicitly downloadable chapter assets without learning data."""
import hashlib
import json
import re


def write_offline_manifest(site, bank, catalog):
    packed = json.loads((site / catalog['path']).read_text())
    content_paths = {q['id']: 'question-content/' + q['contentChunk'] + '.json' for q in packed['questions']}
    indexes = {}
    question_assets = {}
    for q in bank['questions']:
        assets = {content_paths[q['id']]}
        text = q['stem'] + q['analysis'] + ''.join(o['text'] for o in q['options'])
        for version, fid in re.findall(r'/api/question-figure/([a-f0-9]{16})/([a-f0-9]{24})', text):
            path = f'figure-index/{fid[:2]}-{version}.json'
            if path not in indexes:
                indexes[path] = json.loads((site / path).read_text())['packs']
            assets.update((path, 'figure-packs/' + indexes[path][fid] + '.json'))
        assets.update(re.findall(r'(?:\./)(question-figures/[a-f0-9]+\.webp)', text))
        assets.update('question-images/' + path for path in re.findall(r'/api/question-image/([a-z0-9-]+/(?:stem|analysis|option-[A-H])/\d+\.webp)', text))
        question_assets[q['id']] = assets
    shell = []
    for path in sorted(site.rglob('*')):
        if not path.is_file() or path.name == '.DS_Store':
            continue
        relative = path.relative_to(site).as_posix()
        if (relative.startswith(('vendor/', 'assets/'))
                or '/' not in relative and path.suffix in {'.html', '.mjs', '.js', '.css', '.png', '.ico'}
                or relative in {'config.json', 'data/manifest.json', 'data/knowledge.json', catalog['path']}):
            shell.append(relative)
    chapters = []
    for subject in bank['subjects']:
        flattened = []
        def walk(items, parent=None):
            for chapter in items:
                flattened.append((chapter, chapter.get('parentId') or parent))
                walk(chapter.get('children', []), chapter['id'])
        walk(subject['chapters'])
        for chapter, parent in flattened:
            ids, pending = {chapter['id']}, [chapter['id']]
            while pending:
                current = pending.pop()
                for child, ancestor in flattened:
                    if ancestor == current and child['id'] not in ids:
                        ids.add(child['id']); pending.append(child['id'])
            questions = [q for q in bank['questions'] if q['subjectId'] == subject['id'] and q['chapterId'] in ids]
            assets = sorted(set().union(*(question_assets[q['id']] for q in questions))) if questions else []
            chapters.append({'id': subject['id'] + ':' + chapter['id'], 'subjectId': subject['id'],
                             'chapterId': chapter['id'], 'name': chapter['name'], 'parentId': parent,
                             'subjectName': subject['name'], 'questions': len(questions), 'assets': assets})
    paths = set(shell)
    for chapter in chapters:
        paths.update(chapter['assets'])
    files = {name: {'bytes': (site / name).stat().st_size,
                    'sha256': hashlib.sha256((site / name).read_bytes()).hexdigest()} for name in sorted(paths)}
    for chapter in chapters:
        chapter['bytes'] = sum(files[name]['bytes'] for name in chapter['assets'])
    data = {'format': 'zhixing.offline.v1', 'bankRevision': bank['revision'], 'shell': shell,
            'shellBytes': sum(files[name]['bytes'] for name in shell), 'files': files, 'chapters': chapters}
    raw = json.dumps(data, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()
    data['version'] = hashlib.sha256(raw).hexdigest()
    (site / 'offline-manifest.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    return data
