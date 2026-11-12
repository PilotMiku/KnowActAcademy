"""Build a lightweight question catalog and immutable section content chunks."""
import hashlib
import json


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def pack_questions(bank, destination, target_bytes=128 * 1024):
    folder = destination / 'question-content'
    folder.mkdir()
    pointers, pending = {}, []
    size, scope, count = 0, None, 0

    def flush():
        nonlocal pending, size, count
        if not pending:
            return
        payload = encode({'format': 'zhixing.question-chunk.v1', 'revision': bank['revision'], 'questions': pending})
        digest = hashlib.sha256(payload).hexdigest()[:16]
        (folder / (digest + '.json')).write_bytes(payload)
        pointers.update({q['id']: digest for q in pending})
        pending, size = [], 0
        count += 1

    for q in bank['questions']:
        current = (q['subjectId'], q['chapterId'])
        entry_size = len(encode(q)) + 1
        if current != scope or pending and size + entry_size > target_bytes:
            flush()
        scope = current
        pending.append(q)
        size += entry_size
    flush()
    fields = ['id', 'subjectId', 'chapterId', 'type', 'answer', 'tags', 'sourceLabel',
              'searchText', 'answerVerified', 'sourceIncomplete', 'concepts', 'acceptedAnswers', 'difficulty']
    catalog = {**bank, 'contentCatalog': {'format': 'zhixing.question-catalog.v1', 'revision': bank['revision']}}
    catalog['questions'] = []
    for q in bank['questions']:
        record = {k: q[k] for k in fields if k in q}
        record.update(stem=q.get('sourceLabel') or q['id'], analysis='',
                      options=[{'id': o['id'], 'text': o['id']} for o in q['options']],
                      contentChunk=pointers[q['id']])
        if q.get('source', {}).get('format') in {'pdf', 'html'}:
            record['source'] = {'format': q['source']['format']}
        catalog['questions'].append(record)
    payload = encode(catalog)
    digest = hashlib.sha256(payload).hexdigest()
    path = 'data/question-catalog-' + digest[:16] + '.json'
    (destination / path).write_bytes(payload)
    return {'path': path, 'sha256': digest, 'bytes': len(payload), 'chunks': count}
