import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from pack_questions import pack_questions


class QuestionPackTests(unittest.TestCase):
    def test_preview_decodes_entities_and_keeps_quality_flags_without_changing_source(self):
        question = dict(id='q', subjectId='math', chapterId='section', type='single',
                        stem='<p>公式 \\(x&lt;y\\) &amp; 图形<img src="figure"></p>',
                        options=[{'id': 'A', 'text': 'A'}], answer='A', analysis='', analysisMissing=True)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'data').mkdir()
            packed = pack_questions({'revision': 'pdf-abcd', 'questions': [question], 'subjects': []}, root)
            entry = json.loads((root / packed['path']).read_bytes())['questions'][0]
            self.assertEqual(entry['previewText'], '公式 \\(x<y\\) & 图形')
            self.assertTrue(entry['previewHasImages'])
            self.assertTrue(entry['analysisMissing'])
            body = json.loads((root / 'question-content' / (entry['contentChunk'] + '.json')).read_bytes())
            self.assertEqual(body['questions'][0], question)

    def test_catalog_is_light_and_every_body_retains_its_exact_source_record(self):
        questions = [dict(id='q'+str(i), subjectId='math', chapterId='chapter'+str(i//2),
            type='single', stem='原始题干'*30, options=[{'id': 'A', 'text': '选项全文'}],
            answer='A', analysis='原始解析'*50, source={'page': i+1, 'format': 'pdf' if i % 2 else 'html'}) for i in range(5)]
        bank = {'revision': 'pdf-abcd', 'questions': questions, 'subjects': []}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'data').mkdir()
            result = pack_questions(bank, root, target_bytes=2000)
            catalog = json.loads((root / result['path']).read_bytes())
            self.assertEqual(len(catalog['questions']), len(questions))
            for original, entry in zip(questions, catalog['questions']):
                body = json.loads((root / 'question-content' / (entry['contentChunk']+'.json')).read_bytes())
                self.assertEqual(next(q for q in body['questions'] if q['id'] == original['id']), original)
                self.assertEqual(entry['analysis'], '')
                self.assertEqual(entry['source'], {'format': original['source']['format']})
            self.assertLess(result['bytes'], len(json.dumps(bank, ensure_ascii=False).encode()))
