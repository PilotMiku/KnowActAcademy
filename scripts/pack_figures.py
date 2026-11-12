"""Pack unchanged figure bytes in question order; preserve legacy reference IDs."""
import hashlib
import json
from collections import defaultdict
import re

REFERENCE = re.compile(r'/api/question-figure/([a-f0-9]{16})/([a-f0-9]{24})')
TARGET_BYTES = 64 * 1024


def content(question):
    return question['stem'] + ''.join(o['text'] for o in question['options']) + question['analysis']


def pack_figures(source, destination, bank, target_bytes=TARGET_BYTES):
    originals, versions = {}, {}
    for path in sorted(source.glob('*.json')):
        chunk = json.loads(path.read_text())
        for fid, value in chunk['figures'].items():
            if fid in originals:
                raise ValueError('Duplicate figure: ' + fid)
            originals[fid] = value
            versions[fid] = path.stem.split('-')[-1]
    packs = destination / 'figure-packs'
    indexes = destination / 'figure-index'
    packs.mkdir()
    indexes.mkdir()
    pointers, pending = {}, {}
    size, previous_scope, count = 0, None, 0

    def flush():
        nonlocal pending, size, count
        if not pending:
            return
        payload = json.dumps({'format': 'zhixing.figure-chunk.v1', 'figures': pending}, separators=(',', ':'), sort_keys=True).encode()
        digest = hashlib.sha256(payload).hexdigest()[:16]
        (packs / (digest + '.json')).write_bytes(payload)
        pointers.update({fid: digest for fid in pending})
        pending, size = {}, 0
        count += 1

    for question in bank['questions']:
        scope = (question['subjectId'], question['chapterId'])
        if scope != previous_scope:
            flush()
        previous_scope = scope
        for version, fid in REFERENCE.findall(content(question)):
            if fid not in originals or version != versions[fid]:
                raise ValueError('Invalid figure reference: ' + fid)
            if fid in pointers or fid in pending:
                continue
            value = originals[fid]
            entry_size = len(fid) + len(value) + 6
            if pending and size + entry_size > target_bytes:
                flush()
            pending[fid] = value
            size += entry_size
    flush()
    groups = defaultdict(dict)
    for fid, digest in pointers.items():
        groups[fid[:2] + '-' + versions[fid]][fid] = digest
    for name, entries in groups.items():
        (indexes / (name + '.json')).write_text(json.dumps({'format': 'zhixing.figure-index.v1', 'packs': entries}, separators=(',', ':'), sort_keys=True))
    return {'figures': len(pointers), 'figureChunks': count, 'figureIndexes': len(groups)}
