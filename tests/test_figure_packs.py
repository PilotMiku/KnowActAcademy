import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from pack_figures import pack_figures


class FigurePackTests(unittest.TestCase):
    def test_repacking_preserves_bytes_shares_duplicates_and_resolves_old_references(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, output = root / 'source', root / 'output'
            source.mkdir()
            output.mkdir()
            a, b, version = 'ab' + '0' * 22, 'cd' + '1' * 22, '1234567890abcdef'
            values = {a: 'data:image/webp;base64,AAAA', b: 'data:image/webp;base64,BBBB'}
            for fid, value in values.items():
                (source / (fid[:2] + '-' + version + '.json')).write_text(json.dumps({'figures': {fid: value}}))
            bank = {'questions': [dict(subjectId='math', chapterId='one', stem=f'<img src="/api/question-figure/{version}/{a}">', options=[], analysis=f'/api/question-figure/{version}/{b}'), dict(subjectId='math', chapterId='two', stem=f'/api/question-figure/{version}/{a}', options=[], analysis='')]}
            report = pack_figures(source, output, bank)
            self.assertEqual(report['figures'], 2)
            self.assertEqual(report['figureChunks'], 1)
            for fid, value in values.items():
                index = json.loads((output / 'figure-index' / (fid[:2] + '-' + version + '.json')).read_text())
                chunk = json.loads((output / 'figure-packs' / (index['packs'][fid] + '.json')).read_text())
                self.assertEqual(chunk['figures'][fid], value)
