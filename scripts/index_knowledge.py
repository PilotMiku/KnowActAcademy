"""Index the supplied study notes without rewriting their content or inventing questions."""
import hashlib
import html
import json
import math
import pathlib
import re

import fitz
import markdown

from catalog import write_json
from read_study_document import read_docx, read_text
from study_sources import load_materials

ROOT = pathlib.Path(__file__).resolve().parents[1]
NUMBERS = {name: i for i, name in enumerate(
    ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
     '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九'], 0)}


def plain_text(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', ' ', value))).strip()


def render_note(body):
    rendered = markdown.markdown(body, extensions=['sane_lists', 'tables', 'fenced_code'])
    return add_headings(rendered)


def add_headings(rendered):
    headings = []

    def heading(match):
        target = 'knowledge-heading-' + str(len(headings) + 1)
        headings.append({'id': target, 'level': int(match[1]), 'title': plain_text(match[2])})
        return f'<h{match[1]} id="{target}">{match[2]}</h{match[1]}>'

    rendered = re.sub(r'<h([1-6])>(.*?)</h\1>', heading, rendered, flags=re.S)
    return rendered, headings


def note_sections(text):
    anchors = list(re.finditer(r'^#\s+(.+?)\s*$', text, re.M))
    if not anchors:
        raise ValueError('A study note is missing its top-level title')
    if text[:anchors[0].start()].strip():
        raise ValueError('Unclassified content before the first title; preserve it explicitly before indexing')
    return [(m[1], text[m.end():anchors[i+1].start() if i+1 < len(anchors) else len(text)].strip())
            for i, m in enumerate(anchors)]


def order_for(title, source):
    if title == '导论':
        return 0, '章节笔记'
    if title == '结语':
        return 18, '章节笔记'
    chapter = re.match(r'第([一二三四五六七八九十]+)章', title)
    if chapter:
        return NUMBERS[chapter[1]], '章节笔记'
    parent_chapter = re.search(r'第([一二三四五六七八九十]+)章', source.parent.name)
    if parent_chapter:
        return NUMBERS[parent_chapter[1]], '章节笔记'
    return 30, '专题提纲'


def build_knowledge(root=ROOT):
    root = pathlib.Path(root).resolve()
    source_root = root / 'question-bank/习概'
    files = sorted(p for p in source_root.rglob('*') if p.suffix.lower() in {'.md', '.pdf'})
    if not files:
        raise ValueError('No study notes were found in question-bank/习概')
    materials_path = root / 'data/study-materials.json'
    materials = load_materials(root)
    material_paths = set()
    for item in materials:
        path = root / item['path']
        if item['path'] in material_paths or path in files:
            raise ValueError('Duplicate study material: ' + item['path'])
        if not path.is_file():
            raise ValueError('学习资料文件缺失：' + item['path'])
        material_paths.add(item['path'])
        files.append(path)
    existing_path = root / 'data/knowledge-sources.json'
    existing = json.loads(existing_path.read_text()) if existing_path.exists() else {'sources': []}
    existing_ids = {s['path']: s['id'] for s in existing['sources']}
    material_ids = {m['path']: m['id'] for m in materials if 'id' in m}
    for path, identity in material_ids.items():
        if path in existing_ids and existing_ids[path] != identity:
            raise ValueError('已有学习资料不得更改 id：' + path)
    sources = []
    source_ids = set()
    pdf_text = {}
    for path in files:
        if (root / 'question-bank').resolve() not in path.resolve().parents:
            raise ValueError('A study source points outside question-bank: ' + str(path))
        relative = path.relative_to(root).as_posix()
        identity = material_ids.get(relative) or existing_ids.get(relative) or 'ks-' + hashlib.sha256(relative.encode()).hexdigest()[:12]
        if not re.fullmatch(r'ks-[a-f0-9]{12}', identity) or identity in source_ids:
            raise ValueError('Invalid or duplicate study-source ID: ' + str(identity))
        source_ids.add(identity)
        source = {'id': identity, 'path': relative, 'name': path.name, 'type': path.suffix[1:].lower(),
                  'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        if path.suffix.lower() == '.pdf':
            with fitz.open(path) as document:
                source['pages'] = len(document)
                pdf_text[relative] = [re.sub(r'\s+', '', page.get_text()) for page in document]
        sources.append(source)
    source_by_path = {s['path']: s for s in sources}
    articles, paired_pdfs = [], set()
    notice = ''
    for path in files:
        if path.suffix != '.md' or path.relative_to(root).as_posix() in material_paths:
            continue
        text = path.read_text(encoding='utf-8-sig')
        if path.name == 'README.md':
            notice = markdown.markdown(text)
            continue
        md_source = source_by_path[path.relative_to(root).as_posix()]
        pdfs = sorted(path.parent.glob('*.pdf'))
        if len(pdfs) != 1:
            raise ValueError('A note must have exactly one matching original PDF: ' + str(path))
        pdf_path = pdfs[0].relative_to(root).as_posix()
        pdf_source = source_by_path[pdf_path]
        paired_pdfs.add(pdf_path)
        for title, body in note_sections(text):
            identity = 'kp-' + hashlib.sha256((md_source['id'] + '\0' + title).encode()).hexdigest()[:12]
            rendered, headings = render_note(body)
            search_text = plain_text(rendered)
            order, category = order_for(title, path)
            needle = re.sub(r'\s+', '', plain_text(title))
            page = next((i + 1 for i, content in enumerate(pdf_text[pdf_path]) if needle in content), 1)
            articles.append({'id': identity, 'title': title, 'category': category, 'order': order,
                             'kind': 'note', 'body': body, 'html': rendered, 'headings': headings,
                             'searchText': search_text, 'excerpt': search_text[:105],
                             'minutes': max(1, math.ceil(len(search_text) / 450)),
                             'sources': [{'id': md_source['id']}, {'id': pdf_source['id'], 'page': page}]})
    for number, item in enumerate(materials):
        source = source_by_path[item['path']]
        path = root / item['path']
        if source['type'] == 'pdf':
            continue
        if source['type'] == 'docx':
            rendered, headings = add_headings(read_docx(path))
            body = ''
        elif source['type'] == 'txt':
            rendered, headings = read_text(path), []
            body = path.read_text(encoding='utf-8-sig')
        else:
            body = path.read_text(encoding='utf-8-sig')
            rendered, headings = render_note(body)
        search_text = plain_text(rendered)
        articles.append({'id': 'kp-' + source['id'][3:], 'title': item.get('title') or path.stem,
                         'category': item['category'], 'order': 50 + number,
                         'kind': 'note', 'body': body, 'html': rendered, 'headings': headings,
                         'searchText': search_text, 'excerpt': search_text[:105],
                         'minutes': max(1, math.ceil(len(search_text) / 450)),
                         'sources': [{'id': source['id']}]})
    for source in sources:
        if source['type'] == 'pdf' and source['path'] not in paired_pdfs:
            search_text = ' '.join(pdf_text[source['path']])
            material = next((m for m in materials if m['path'] == source['path']), None)
            articles.append({'id': 'kp-' + source['id'][3:], 'title': (material or {}).get('title') or pathlib.Path(source['name']).stem,
                             'kind': 'pdf', 'category': material['category'] if material else '汇编资料', 'order': 40,
                             'body': '', 'html': '', 'headings': [], 'searchText': search_text,
                             'excerpt': '原始 PDF 汇编资料，可直接打开阅读。',
                             'minutes': 0, 'sources': [{'id': source['id'], 'page': 1}]})
    articles.sort(key=lambda a: (a['order'], a['title']))
    if len({a['id'] for a in articles}) != len(articles):
        raise ValueError('Duplicate study-note titles within the same source')
    revision = 'knowledge-' + hashlib.sha256(json.dumps(
        {'sources': [(s['id'], s['sha256']) for s in sources], 'materials': materials,
         'renderer': 2}, ensure_ascii=False).encode()).hexdigest()[:16]
    stats = {'notes': sum(a['kind'] == 'note' for a in articles), 'pdfCollections': sum(a['kind'] == 'pdf' for a in articles),
             'markdownFiles': sum(s['type'] == 'md' and s['name'] != 'README.md' for s in sources),
             'pdfFiles': sum(s['type'] == 'pdf' for s in sources), 'articles': len(articles),
             'docxFiles': sum(s['type'] == 'docx' for s in sources),
             'textFiles': sum(s['type'] == 'txt' for s in sources),
             'materials': len(materials),
             'sections': sum(len(a['headings']) for a in articles)}
    bundle = {'revision': revision, 'name': '学习资料', 'stats': stats, 'articles': articles,
              'sourceNotice': notice, 'sources': {s['id']: s for s in sources}}
    registry = {'revision': revision, 'sources': sources}
    if materials_path.exists():
        registry['materialsSha256'] = hashlib.sha256(materials_path.read_bytes()).hexdigest()
    write_json(root / 'data/knowledge-sources.json', registry, pretty=True)
    write_json(root / 'dist/data/knowledge.json', bundle)
    return bundle


if __name__ == '__main__':
    bundle = build_knowledge()
    print(json.dumps({'revision': bundle['revision'], **bundle['stats']}, ensure_ascii=False))
