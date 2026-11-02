import hashlib
import json
import pathlib
import re
import sys
import unittest
import tempfile
import zipfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from index_knowledge import note_sections, render_note
from index_knowledge import plain_text
from study_sources import source_report, verify_sources, source_files
from read_study_document import read_docx


class KnowledgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / 'dist/data/knowledge.json').read_text())
        cls.registry = json.loads((ROOT / 'data/knowledge-sources.json').read_text())

    def test_every_source_is_registered_and_unchanged(self):
        catalog = json.loads((ROOT / 'data/catalog.json').read_text())
        math_paths = {d['path'] for s in catalog['subjects'] for c in s['chapters'] for d in c['documents']}
        actual = {p.relative_to(ROOT).as_posix() for p in source_files(ROOT)} - math_paths
        self.assertEqual(actual, {s['path'] for s in self.registry['sources']})
        self.assertEqual(source_report(ROOT), {'unregistered': [], 'unsupported': [], 'missing': [], 'changed': []})
        for source in self.registry['sources']:
            self.assertEqual(hashlib.sha256((ROOT / source['path']).read_bytes()).hexdigest(), source['sha256'])
        self.assertEqual(self.registry['revision'], self.data['revision'])
        original = json.loads((ROOT / 'docs/original-checksums.json').read_text())
        for path, digest in original.items():
            if path.startswith('question-bank/习概/') and not pathlib.Path(path).name.startswith('.'):
                self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), digest, path)

    def test_all_combined_chapter_sections_preserve_their_original_text(self):
        notes = [a for a in self.data['articles'] if a['kind'] == 'note'
                 and self.data['sources'][a['sources'][0]['id']]['type'] == 'md'
                 and self.data['sources'][a['sources'][0]['id']]['path'].startswith('question-bank/习概/')]
        expected_count = 0
        expected_headings = 0
        for source in self.registry['sources']:
            if source['type'] != 'md' or source['name'] == 'README.md' or not source['path'].startswith('question-bank/习概/'):
                continue
            expected = note_sections((ROOT / source['path']).read_text(encoding='utf-8-sig'))
            indexed = [(a['title'], a['body']) for a in notes if a['sources'][0]['id'] == source['id']]
            self.assertEqual(sorted(expected), sorted(indexed), source['path'])
            expected_count += len(expected)
            expected_headings += sum(len(render_note(body)[1]) for _, body in expected)
        self.assertEqual(len(notes), expected_count)
        for article in notes:
            for heading in article['headings']:
                self.assertIn('id="' + heading['id'] + '"', article['html'])
        self.assertEqual(sum(len(a['headings']) for a in notes), expected_headings)
        self.assertEqual(len({a['id'] for a in self.data['articles']}), len(self.data['articles']))

    def test_new_materials_preserve_all_word_text_tables_and_line_breaks(self):
        materials = json.loads((ROOT / 'data/study-materials.json').read_text())['materials']
        for material in materials:
            source = next(s for s in self.registry['sources'] if s['path'] == material['path'])
            article = next(a for a in self.data['articles'] if a['sources'][0]['id'] == source['id'])
            self.assertEqual(article['category'], material['category'])
            path = ROOT / source['path']
            if source['type'] == 'txt':
                self.assertEqual(plain_text(article['html']), re.sub(r'\s+', ' ', path.read_text()).strip())
                continue
            if source['type'] == 'md':
                self.assertEqual(article['body'], path.read_text(encoding='utf-8-sig'))
                continue
            if source['type'] == 'pdf':
                self.assertEqual(article['kind'], 'pdf')
                continue
            with zipfile.ZipFile(path) as archive:
                doc = ET.fromstring(archive.read('word/document.xml'))
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            normalize = lambda value: re.sub(r'\s+', '', value)
            expected = ''.join(n.text or '' for n in doc.findall('.//w:t', ns))
            self.assertEqual(normalize(plain_text(article['html'])), normalize(expected), path)
            self.assertEqual(article['html'].count('<table>'), len(doc.findall('.//w:tbl', ns)))
            expected_headings = [n for n in doc.findall('.//w:pStyle', ns)
                                 if n.get('{'+ns['w']+'}val', '').startswith('Heading')]
            self.assertEqual(len(article['headings']), len(expected_headings))
            line_breaks = [n for n in doc.findall('.//w:br', ns) if n.get('{'+ns['w']+'}type') != 'page']
            self.assertEqual(article['html'].count('<br>') + article['html'].count('\n') >= len(line_breaks), True)

    def test_inventory_detects_new_unsupported_changed_and_missing_sources(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / 'data').mkdir()
            bank = root / 'question-bank/其他'
            bank.mkdir(parents=True)
            (root / 'data/catalog.json').write_text('{"subjects": []}')
            changed = bank / 'changed.txt'
            changed.write_text('changed')
            (bank / 'new.docx').write_bytes(b'new')
            (bank / 'unsupported.xls').write_bytes(b'unknown')
            (bank / '.DS_Store').touch()
            (bank / '~$lock.docx').touch()
            (root / 'data/knowledge-sources.json').write_text(json.dumps({'sources': [
                {'path': 'question-bank/其他/changed.txt', 'sha256': 'old'},
                {'path': 'question-bank/其他/missing.txt', 'sha256': 'old'}]}))
            report = source_report(root)
            self.assertEqual(report['unregistered'], ['question-bank/其他/new.docx', 'question-bank/其他/unsupported.xls'])
            self.assertEqual(report['unsupported'], ['question-bank/其他/unsupported.xls'])
            self.assertEqual(report['changed'], ['question-bank/其他/changed.txt'])
            self.assertEqual(report['missing'], ['question-bank/其他/missing.txt'])
            with self.assertRaisesRegex(ValueError, '登记或校验不完整'):
                verify_sources(root)

    def test_word_conversion_rejects_unhandled_embedded_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / 'image.docx'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>')
            with self.assertRaisesRegex(ValueError, '尚未支持'):
                read_docx(path)

    def test_registered_pdf_pages_are_valid_for_each_reading_link(self):
        for article in self.data['articles']:
            for reference in article['sources']:
                source = self.data['sources'][reference['id']]
                if source['type'] == 'pdf':
                    self.assertTrue(1 <= reference['page'] <= source['pages'])
        all_pdfs = {s['id'] for s in self.registry['sources'] if s['type'] == 'pdf'}
        paired_pdfs = {ref['id'] for a in self.data['articles'] if a['kind'] == 'note'
                       for ref in a['sources'] if self.data['sources'][ref['id']]['type'] == 'pdf'}
        self.assertEqual({a['sources'][0]['id'] for a in self.data['articles'] if a['kind'] == 'pdf'}, all_pdfs - paired_pdfs)


if __name__ == '__main__':
    unittest.main()
