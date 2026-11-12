from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from count_questions import recount, check_report


class QuestionCountsTests(unittest.TestCase):
    def test_current_bank_matches_report_without_modifying_any_record(self):
        report = check_report()
        self.assertTrue(report['sources']['originalIdsPreserved'])
        self.assertEqual(report['counts']['total'], 8425)
        self.assertEqual(report['counts']['scorable'], 8406)

    def test_nested_scopes_direct_questions_and_same_chapter_id_in_other_subject(self):
        bank = dict(revision='test', subjects=[
            dict(id='a', name='A', chapters=[dict(id='root', name='Root', children=[
                dict(id='leaf', name='Leaf', children=[dict(id='nested', name='Nested')])])]),
            dict(id='b', name='B', chapters=[dict(id='root', name='Other root')])],
            questions=[dict(id='q1', subjectId='a', chapterId='root'),
                       dict(id='q2', subjectId='a', chapterId='nested'),
                       dict(id='q3', subjectId='b', chapterId='root')])
        report = recount(bank)
        self.assertEqual(report['counts']['total'], 3)
        self.assertEqual([s['counts']['total'] for s in report['subjects']], [2, 1])
        self.assertEqual([c['counts']['total'] for c in report['subjects'][0]['chapters']], [2, 1, 1])
        self.assertEqual(report['subjects'][0]['chapters'][0]['directCount'], 1)
        bank['questions'].append(bank['questions'][0])
        with self.assertRaisesRegex(ValueError, '题号重复'):
            recount(bank)
