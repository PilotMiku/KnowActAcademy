"""Isolated real HTTP backend for browser regression; credentials go only to the parent pipe."""
import json
from pathlib import Path
import sys
import tempfile
from wsgiref.simple_server import make_server, WSGIRequestHandler

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import ProgressAPI, create_user


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


with tempfile.TemporaryDirectory(prefix='zhixing-test-api-') as temporary:
    database = Path(temporary) / 'progress.sqlite3'
    key = create_user(database, 'browser-test')
    api = ProgressAPI(database, [sys.argv[1]])
    with make_server('127.0.0.1', 0, api, handler_class=QuietHandler) as server:
        print(json.dumps({'url': f'http://127.0.0.1:{server.server_port}', 'key': key}), flush=True)
        server.serve_forever()
