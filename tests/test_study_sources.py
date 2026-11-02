import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

import fitz

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from check_bank import scan_sources, print_report, has_issues
from index_knowledge import build_knowledge
from study_sources import load_materials, source_report


class StudySourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'data').mkdir()
        (self.root / 'data/catalog.json').write_text('{"subjects": []}')
        notes = self.root / 'question-bank/习概/第一章'
        notes.mkdir(parents=True)
        (notes / 'note.md').write_text('# 第一章\n\n## 原始内容\n\n保留原文。')
        self.pdf(notes / 'note.pdf')
        other = self.root / 'question-bank/其他'
        other.mkdir(parents=True)
        (other / 'guide.txt').write_text('第一份学习资料\n保留换行。')
        self.materials = [{'id': 'ks-000000000001', 'path': 'question-bank/其他/guide.txt', 'category': '工具'}]
        self.write_manifest()

    def pdf(self, path):
        with fitz.open() as pdf:
            pdf.new_page().insert_text((72, 72), 'Reference material')
            pdf.save(path)

    def write_manifest(self):
        (self.root / 'data/study-materials.json').write_text(json.dumps({'materials': self.materials}, ensure_ascii=False))

    def test_new_materials_are_reported_before_indexing_and_appended_without_changing_existing_articles(self):
        before = build_knowledge(self.root)
        (self.root / 'question-bank/其他/second.MD').write_text('# 独立 Markdown\n\n无需配套 PDF。')
        self.pdf(self.root / 'question-bank/其他/reference.PDF')
        self.materials.extend([
            {'path': 'question-bank/其他/second.MD', 'category': '工具'},
            {'path': 'question-bank/其他/reference.PDF', 'category': '参考', 'title': '独立 PDF 参考资料'}])
        self.write_manifest()
        report = scan_sources(self.root)
        self.assertTrue(has_issues(report))
        self.assertEqual(report['files'], [])  # Reading PDFs are never parsed as math exports.
        self.assertIn('question-bank/其他/reference.PDF', report['sources']['unregistered'])
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            print_report(report)
        self.assertIn('待生成索引', output.getvalue())
        self.assertIn('python scripts/index_knowledge.py', output.getvalue())
        after = build_knowledge(self.root)
        self.assertEqual(len(after['articles']), len(before['articles']) + 2)
        by_id = {a['id']: a for a in after['articles']}
        for article in before['articles']:
            self.assertEqual(by_id[article['id']], article)
        self.assertTrue(any(a['title'] == '独立 PDF 参考资料' for a in after['articles']))
        self.assertFalse(has_issues(scan_sources(self.root)))

    def test_renames_keep_source_article_and_reading_position_identity(self):
        before = build_knowledge(self.root)
        article = next(a for a in before['articles'] if a['sources'][0]['id'] == self.materials[0]['id'])
        old = self.root / self.materials[0]['path']
        new = old.with_name('renamed.txt')
        old.rename(new)
        self.materials[0]['path'] = new.relative_to(self.root).as_posix()
        self.write_manifest()
        after = build_knowledge(self.root)
        renamed = next(a for a in after['articles'] if a['id'] == article['id'])
        self.assertEqual(renamed['sources'], article['sources'])
        self.assertEqual(renamed['html'], article['html'])
        source_id = article['sources'][0]['id']
        self.assertEqual(before['sources'][source_id]['sha256'], after['sources'][source_id]['sha256'])
        self.assertFalse(has_issues(scan_sources(self.root)))

    def test_existing_id_cannot_be_replaced_and_failed_indexing_keeps_previous_output(self):
        build_knowledge(self.root)
        indexed = self.root / 'dist/data/knowledge.json'
        digest = hashlib.sha256(indexed.read_bytes()).hexdigest()
        self.materials[0]['id'] = 'ks-000000000002'
        self.write_manifest()
        with self.assertRaisesRegex(ValueError, '不得更改 id'):
            build_knowledge(self.root)
        self.assertEqual(hashlib.sha256(indexed.read_bytes()).hexdigest(), digest)

    def test_manifest_validation_explains_invalid_paths_categories_and_duplicate_ids(self):
        valid = self.materials[0].copy()
        for field, value, message in [('path', '../outside.txt', '路径'), ('path', '/tmp/outside.txt', '路径'),
                                      ('path', 'question-bank/其他/.hidden.txt', '路径'),
                                      ('category', '', 'category'), ('title', [], 'title'), ('id', 'invalid', 'id'),
                                      ('path', 'question-bank/其他/unsupported.xls', '格式不支持')]:
            with self.subTest(field=field, value=value):
                self.materials = [{**valid, field: value}]
                self.write_manifest()
                with self.assertRaisesRegex(ValueError, message):
                    load_materials(self.root)
        for second in [valid.copy(), {**valid, 'path': 'question-bank/其他/other.txt'}]:
            self.materials = [valid, second]
            self.write_manifest()
            with self.assertRaisesRegex(ValueError, '重复'):
                load_materials(self.root)

    def test_missing_manifest_and_changed_metadata_require_reindexing(self):
        build_knowledge(self.root)
        self.materials[0]['category'] = '新分类'
        self.write_manifest()
        self.assertIn('data/study-materials.json', source_report(self.root)['changed'])
        (self.root / 'data/study-materials.json').unlink()
        self.assertIn('data/study-materials.json', source_report(self.root)['missing'])

    def test_unregistered_files_have_registration_guidance_and_success_is_concise(self):
        build_knowledge(self.root)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            print_report(scan_sources(self.root))
        self.assertIn('检查通过', output.getvalue())
        self.assertEqual(len(output.getvalue().splitlines()), 3)
        (self.root / 'question-bank/其他/unregistered.txt').write_text('新文件')
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            print_report(scan_sources(self.root))
        self.assertIn('学习资料待登记', output.getvalue())
        self.assertIn('data/study-materials.json', output.getvalue())


if __name__ == '__main__':
    unittest.main()
