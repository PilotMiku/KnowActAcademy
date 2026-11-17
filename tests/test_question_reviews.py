import copy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from question_reviews import ROOT, apply_reviews, records, publish

class QuestionReviewsTests(unittest.TestCase):
    def test_published_reviews_match_and_are_idempotent(self):
        publish(check=True)
        bank=json.loads((ROOT/'dist/data/bank.json').read_text())
        self.assertEqual(apply_reviews(copy.deepcopy(bank)),bank)

    def test_changed_source_or_key_cannot_receive_stale_review(self):
        bank=json.loads((ROOT/'dist/data/bank.json').read_text())
        qid,row=next(iter(records().items()))
        q=next(q for q in bank['questions'] if q['id']==qid)
        q['source']['sha256']='different'
        with self.assertRaisesRegex(ValueError,'no longer matches'):
            apply_reviews(bank,{qid:row})
        q['source']['sha256']=row['sourceSha256'];q['answer']='invalid'
        with self.assertRaisesRegex(ValueError,'no longer matches'):
            apply_reviews(bank,{qid:row})
