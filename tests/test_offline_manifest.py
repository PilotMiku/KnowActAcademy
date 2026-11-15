import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from pack_questions import pack_questions
from offline_manifest import write_offline_manifest


class OfflineManifestTests(unittest.TestCase):
    def test_download_includes_shared_figures_and_nested_scope_without_exporting_user_data(self):
        with tempfile.TemporaryDirectory() as folder:
            site=Path(folder)
            for name in ['data','figure-index','figure-packs']:(site/name).mkdir()
            (site/'index.html').write_text('page')
            (site/'app.mjs').write_text('code')
            (site/'sw.js').write_text('worker')
            (site/'data/bank.json').write_text('full bank is not offline bootstrap')
            fid='ab'+'1'*22;version='2'*16;pack='3'*16
            (site/f'figure-index/ab-{version}.json').write_text(json.dumps({'packs':{fid:pack}}))
            (site/f'figure-packs/{pack}.json').write_text('original bytes')
            bank={'revision':'pdf-test','subjects':[{'id':'s','name':'学科','chapters':[{'id':'root','name':'大章','children':[{'id':'child','name':'小节'}]}]}],
                  'questions':[{'id':'q','subjectId':'s','chapterId':'child','type':'single','stem':f'<img src="/api/question-figure/{version}/{fid}">','analysis':'','options':[{'id':'A','text':'A'}],'answer':'A'}]}
            catalog=pack_questions(bank,site)
            manifest=write_offline_manifest(site,bank,catalog)
            root,child=manifest['chapters']
            self.assertEqual(root['assets'],child['assets'])
            self.assertIn(f'figure-packs/{pack}.json',child['assets'])
            self.assertNotIn('data/bank.json',manifest['files'])
            self.assertIn('sw.js',manifest['shell'])
            self.assertEqual(manifest,write_offline_manifest(site,bank,catalog))
            (site/'app.mjs').write_text('new code')
            self.assertNotEqual(manifest['version'],write_offline_manifest(site,bank,catalog)['version'])
            for name,record in manifest['files'].items():
                if name!='app.mjs':self.assertEqual(record['sha256'],hashlib.sha256((site/name).read_bytes()).hexdigest())
