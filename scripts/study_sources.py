"""Shared source inventory for indexing, intake checks and static builds."""
import hashlib
import json
import re
from pathlib import Path
from source_archives import load_archives

SUPPORTED = {'.pdf', '.md', '.docx', '.txt'}


def load_materials(root):
    root = Path(root).resolve()
    manifest = root / 'data/study-materials.json'
    if not manifest.exists():
        return []
    data = json.loads(manifest.read_text())
    if not isinstance(data, dict) or not isinstance(data.get('materials'), list):
        raise ValueError('data/study-materials.json 须包含 materials 数组')
    paths, ids = set(), set()
    for item in data['materials']:
        if not isinstance(item, dict) or not isinstance(item.get('path'), str):
            raise ValueError('每份学习资料须填写 path')
        relative = Path(item['path'])
        resolved = (root / relative).resolve()
        if (relative.is_absolute() or item['path'] != relative.as_posix()
                or '..' in relative.parts or not relative.parts or relative.parts[0] != 'question-bank'
                or any(part.startswith('.') or part.startswith('~$') for part in relative.parts)
                or (root / 'question-bank').resolve() not in resolved.parents):
            raise ValueError('学习资料路径须位于 question-bank 内：' + item['path'])
        if resolved.suffix.lower() not in SUPPORTED:
            raise ValueError('学习资料格式不支持：' + item['path'])
        if item['path'] in paths:
            raise ValueError('学习资料重复登记：' + item['path'])
        paths.add(item['path'])
        if not isinstance(item.get('category'), str) or not item['category'].strip():
            raise ValueError('学习资料须填写分类 category：' + item['path'])
        if 'title' in item and (not isinstance(item['title'], str) or not item['title'].strip()):
            raise ValueError('学习资料 title 须为非空文字：' + item['path'])
        if 'id' in item:
            if not isinstance(item['id'], str) or not re.fullmatch(r'ks-[a-f0-9]{12}', item['id']):
                raise ValueError('学习资料 id 格式错误：' + item['path'])
            if item['id'] in ids:
                raise ValueError('学习资料 id 重复：' + item['id'])
            ids.add(item['id'])
    return data['materials']


def source_files(root):
    root = Path(root)
    return sorted(p for p in (root / 'question-bank').rglob('*')
                  if p.is_file() and not any(part.startswith('.') or part.startswith('~$')
                                           for part in p.relative_to(root / 'question-bank').parts))


def source_report(root):
    root = Path(root).resolve()
    load_materials(root)
    catalog = json.loads((root / 'data/catalog.json').read_text())
    math = {d['path'] for s in catalog['subjects'] for c in s['chapters'] for d in c['documents']}
    registry = root / 'data/knowledge-sources.json'
    metadata = json.loads(registry.read_text()) if registry.exists() else {}
    sources = metadata.get('sources', [])
    supplement_registry = root / 'data/supplement-sources.json'
    supplements = []
    if supplement_registry.exists():
        supplementary = json.loads(supplement_registry.read_text())
        if supplementary.get('format') != 'zhixing.supplement-sources.v1':
            raise ValueError('补充题库来源登记格式不支持')
        supplements = supplementary.get('sources', [])
        seen = set()
        for source in supplements:
            relative = Path(source['path'])
            resolved = (root / relative).resolve()
            if (relative.is_absolute() or '..' in relative.parts
                    or not relative.parts or relative.parts[0] != 'question-bank'
                    or relative.suffix.lower() != '.html'
                    or (root / 'question-bank').resolve() not in resolved.parents
                    or source['path'] in seen
                    or not re.fullmatch(r'[a-f0-9]{64}', source.get('sha256', ''))):
                raise ValueError('补充题库来源登记无效：' + source['path'])
            seen.add(source['path'])
    registered = math | {s['path'] for s in sources + supplements}
    actual = {p.relative_to(root).as_posix(): p for p in source_files(root)}
    changed = []
    materials = root / 'data/study-materials.json'
    if materials.exists() and metadata.get('materialsSha256') != hashlib.sha256(materials.read_bytes()).hexdigest():
        changed.append('data/study-materials.json')
    for source in sources + supplements:
        path = root / source['path']
        if (root / 'question-bank').resolve() not in path.resolve().parents:
            raise ValueError('学习资料路径越界：' + source['path'])
        if source['path'] in actual and hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
            changed.append(source['path'])
    archives = load_archives(root)
    missing = registered - set(actual) - set(archives)
    if metadata.get('materialsSha256') and not materials.exists():
        missing.add('data/study-materials.json')
    return {'unregistered': sorted(set(actual) - registered),
            'unsupported': sorted(name for name, p in actual.items()
                                  if p.suffix.lower() not in SUPPORTED
                                  and name not in {s['path'] for s in supplements}),
            'missing': sorted(missing), 'changed': sorted(changed)}


def verify_sources(root):
    report = source_report(root)
    if any(report.values()):
        raise ValueError('原始资料登记或校验不完整，请先更新索引：' + json.dumps(report, ensure_ascii=False))
