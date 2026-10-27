from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import ProgressAPI, create_user, MAX_BODY


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.db = Path(self.temporary.name) / 'progress.sqlite3'
        self.token = create_user(self.db, 'learner-one')
        self.other = create_user(self.db, 'learner-two')
        self.api = ProgressAPI(self.db, ['https://student.github.io'])
        self.payload = {'format': 'zhixing.progress.v1', 'bankRevision': 'pdf-abcd', 'state': {
            'attempts': [], 'favorites': [], 'mistakes': {}, 'exams': [], 'theme': 'light',
            'knowledgeRead': [], 'knowledgeFavorites': []}}

    def request(self, method='GET', token=None, origin='https://student.github.io', version=None,
                payload=None, path='/v1/progress', **extra):
        body = json.dumps(payload).encode() if payload is not None else b''
        environ = {'REQUEST_METHOD': method, 'PATH_INFO': path, 'HTTP_ORIGIN': origin,
                   'HTTP_AUTHORIZATION': 'Bearer ' + (self.token if token is None else token),
                   'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(body)),
                   'wsgi.input': io.BytesIO(body), **extra}
        if version is not None:
            environ['HTTP_IF_MATCH'] = str(version)
        result = {}
        def start(status, headers):
            result.update(status=int(status.split()[0]), headers=dict(headers))
        result['data'] = json.loads(b''.join(self.api(environ, start)))
        return result

    def test_authentication_cors_and_no_token_storage(self):
        self.assertEqual(self.request(token='bad')['status'], 401)
        self.assertEqual(self.request(token='a'*43)['status'], 401)
        rejected = self.request(origin='https://attacker.example')
        self.assertEqual(rejected['status'], 403)
        self.assertNotIn('Access-Control-Allow-Origin', rejected['headers'])
        self.assertEqual(self.request()['headers']['Access-Control-Allow-Origin'], 'https://student.github.io')
        self.assertNotIn(self.token.encode(), self.db.read_bytes())
        self.assertEqual(self.request(path='/backend/app.py')['status'], 404)

    def test_preflight_and_origin_configuration(self):
        response = self.request(method='OPTIONS', HTTP_ACCESS_CONTROL_REQUEST_METHOD='PUT',
                                HTTP_ACCESS_CONTROL_REQUEST_HEADERS='authorization, content-type, if-match')
        self.assertEqual(response['status'], 200)
        self.assertEqual(self.request(method='OPTIONS', HTTP_ACCESS_CONTROL_REQUEST_METHOD='DELETE')['status'], 403)
        for origin in ['*', 'https://student.github.io/repo', 'https://student.github.io/', 'http://example.com']:
            with self.assertRaises(ValueError):
                ProgressAPI(self.db, [origin])

    def test_save_restore_user_isolation_and_cas(self):
        self.assertEqual(self.request()['data'], {'version': 0, 'payload': None, 'updatedAt': None})
        self.assertEqual(self.request('PUT', version=0, payload=self.payload)['status'], 200)
        self.assertEqual(self.request()['data']['payload'], self.payload)
        self.assertEqual(self.request(token=self.other)['data']['version'], 0)
        self.assertEqual(self.request('PUT', version=0, payload=self.payload)['status'], 409)
        self.assertEqual(self.request()['data']['version'], 1)

    def test_parallel_writers_cannot_overwrite_each_other(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.request, 'PUT', version=0, payload=self.payload) for _ in range(2)]
            self.assertEqual(sorted(f.result()['status'] for f in futures), [200, 409])
        self.assertEqual(self.request()['data']['version'], 1)

    def test_system_theme_and_learning_preferences_roundtrip(self):
        self.payload['state'].update(theme='system', studySettings={'fontSize': 'large', 'lineSpacing': 'relaxed', 'focus': True}, knowledgeRecallDrafts={'note': '核心概念'}, knowledgeRecalled=['note'])
        self.assertEqual(self.request('PUT', version=0, payload=self.payload)['status'], 200)
        self.assertEqual(self.request()['data']['payload'], self.payload)

    def test_validation_and_history(self):
        self.assertEqual(self.request('PUT', payload=self.payload)['status'], 428)
        self.assertEqual(self.request('PUT', version=0, payload={})['status'], 400)
        self.assertEqual(self.request('PUT', version=0, payload=self.payload,
                                      CONTENT_LENGTH=str(MAX_BODY+1))['status'], 413)
        self.assertEqual(self.request('PUT', version=0, payload=self.payload, CONTENT_TYPE='text/plain')['status'], 415)
        for version in range(13):
            self.assertEqual(self.request('PUT', version=version, payload=self.payload)['status'], 200)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM history').fetchone()[0], 10)
        self.assertEqual(self.request()['data']['version'], 13)


if __name__ == '__main__':
    unittest.main()
