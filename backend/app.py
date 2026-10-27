"""Optional progress API: WSGI + SQLite, one independently revocable key per learner."""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
from urllib.parse import urlsplit

MAX_BODY = 10 * 1024 * 1024
FORMAT = 'zhixing.progress.v1'


def connect(path):
    database = sqlite3.connect(path, timeout=15)
    database.execute('PRAGMA foreign_keys=ON')
    return database


def initialize(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(path)) as db, db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
            CREATE TABLE IF NOT EXISTS learners (
                token_hash TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
            CREATE TABLE IF NOT EXISTS snapshots (
                token_hash TEXT PRIMARY KEY REFERENCES learners ON DELETE CASCADE,
                version INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS history (
                token_hash TEXT NOT NULL REFERENCES learners ON DELETE CASCADE,
                version INTEGER NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
                PRIMARY KEY (token_hash, version));
        ''')
    os.chmod(path, 0o600)


def create_user(path, name):
    if not name.strip() or len(name) > 100:
        raise ValueError('用户名称长度必须为 1–100 字符')
    initialize(path)
    token = secrets.token_urlsafe(32)
    with closing(connect(path)) as db, db:
        db.execute('INSERT INTO learners VALUES (?, ?)', (hashlib.sha256(token.encode()).hexdigest(), name))
    return token


def valid_payload(payload):
    if not isinstance(payload, dict) or payload.get('format') != FORMAT:
        return False
    if not re.fullmatch(r'pdf-[a-f0-9]+', str(payload.get('bankRevision', ''))):
        return False
    state = payload.get('state')
    if not isinstance(state, dict):
        return False
    if not all(isinstance(state.get(key), list) for key in
               ['attempts', 'favorites', 'exams', 'knowledgeRead', 'knowledgeFavorites']):
        return False
    return isinstance(state.get('mistakes'), dict) and state.get('theme') in ['light', 'dark', 'system']


class ProgressAPI:
    def __init__(self, database, origins):
        self.database = str(database)
        self.origins = set(origins)
        for origin in self.origins:
            parsed = urlsplit(origin)
            if (parsed.scheme not in ['https', 'http'] or not parsed.netloc or
                    origin != f'{parsed.scheme}://{parsed.netloc}' or parsed.username or
                    (parsed.scheme == 'http' and parsed.hostname not in ['127.0.0.1', 'localhost', '::1'])):
                raise ValueError('允许来源须为 HTTPS 域名（本地调试可用 HTTP），不带路径或结尾斜线')
        initialize(database)

    def __call__(self, environ, start_response):
        origin = environ.get('HTTP_ORIGIN', '')
        headers = [('Content-Type', 'application/json; charset=utf-8'),
                   ('Cache-Control', 'no-store'), ('X-Content-Type-Options', 'nosniff'), ('Vary', 'Origin')]
        if origin in self.origins:
            headers.append(('Access-Control-Allow-Origin', origin))

        def respond(status, value):
            body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
            start_response(status, headers + [('Content-Length', str(len(body)))])
            return [body]

        if origin and origin not in self.origins:
            return respond('403 Forbidden', {'error': '当前网站来源未获允许'})
        path = environ.get('PATH_INFO', '')
        method = environ.get('REQUEST_METHOD', '')
        if path not in ['/v1/health', '/v1/progress']:
            return respond('404 Not Found', {'error': '接口不存在'})
        if method == 'OPTIONS':
            if (not origin or environ.get('HTTP_ACCESS_CONTROL_REQUEST_METHOD') not in ['GET', 'PUT'] or
                    any(h.strip().lower() not in ['authorization', 'content-type', 'if-match']
                        for h in environ.get('HTTP_ACCESS_CONTROL_REQUEST_HEADERS', '').split(',') if h.strip())):
                return respond('403 Forbidden', {'error': '跨域请求未获允许'})
            headers.extend([('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS'),
                            ('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match'),
                            ('Access-Control-Max-Age', '600')])
            return respond('200 OK', {'ok': True})
        if path == '/v1/health':
            if method != 'GET':
                return respond('405 Method Not Allowed', {'error': '方法不支持'})
            return respond('200 OK', {'ok': True, 'service': 'zhixing-progress'})
        auth = environ.get('HTTP_AUTHORIZATION', '')
        if not re.fullmatch(r'Bearer [A-Za-z0-9_-]{43}', auth):
            return respond('401 Unauthorized', {'error': '同步密钥无效或已撤销'})
        token_hash = hashlib.sha256(auth[7:].encode()).hexdigest()
        try:
            with closing(connect(self.database)) as db, db:
                if not db.execute('SELECT 1 FROM learners WHERE token_hash=?', (token_hash,)).fetchone():
                    return respond('401 Unauthorized', {'error': '同步密钥无效或已撤销'})
                if method == 'GET':
                    row = db.execute('SELECT version,payload,updated_at FROM snapshots WHERE token_hash=?',
                                     (token_hash,)).fetchone()
                    return respond('200 OK', {'version': row[0] if row else 0,
                                             'payload': json.loads(row[1]) if row else None,
                                             'updatedAt': row[2] if row else None})
                if method != 'PUT':
                    return respond('405 Method Not Allowed', {'error': '方法不支持'})
                if environ.get('CONTENT_TYPE', '').split(';')[0] != 'application/json':
                    return respond('415 Unsupported Media Type', {'error': '需要 JSON 数据'})
                expected = environ.get('HTTP_IF_MATCH', '')
                if not re.fullmatch(r'0|[1-9]\d{0,14}', expected):
                    return respond('428 Precondition Required', {'error': '缺少同步版本，请重新连接'})
                try:
                    length = int(environ.get('CONTENT_LENGTH', '0'))
                except ValueError:
                    length = 0
                if length <= 0 or length > MAX_BODY:
                    return respond('413 Content Too Large', {'error': '学习数据大小须在 1 字节至 10 MiB 之间'})
                try:
                    raw = environ['wsgi.input'].read(length)
                    if len(raw) != length:
                        raise ValueError('incomplete body')
                    payload = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
                    if not valid_payload(payload):
                        raise ValueError('invalid payload')
                    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False)
                except (ValueError, UnicodeError, RecursionError):
                    return respond('400 Bad Request', {'error': '学习数据格式错误'})
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT version,payload,updated_at FROM snapshots WHERE token_hash=?',
                                 (token_hash,)).fetchone()
                current = row[0] if row else 0
                if current != int(expected):
                    return respond('409 Conflict', {'error': '服务器已有更新，请重新连接后恢复或确认上传',
                                                    'version': current})
                now, version = int(time.time() * 1000), current + 1
                if row:
                    db.execute('INSERT INTO history VALUES (?, ?, ?, ?)', (token_hash, *row))
                db.execute('INSERT INTO snapshots VALUES (?, ?, ?, ?) ON CONFLICT(token_hash) DO UPDATE SET '
                           'version=excluded.version,payload=excluded.payload,updated_at=excluded.updated_at',
                           (token_hash, version, encoded, now))
                db.execute('DELETE FROM history WHERE token_hash=? AND version < ?', (token_hash, version-10))
                # Commit before reporting success; a failed commit must not return a false success.
                db.commit()
                return respond('200 OK', {'version': version, 'updatedAt': now})
        except sqlite3.Error:
            return respond('503 Service Unavailable', {'error': '存储暂不可用，请稍后重试'})


def create_app():
    return ProgressAPI(os.environ.get('ZHIXING_DB', '/data/zhixing.sqlite3'),
                       [x.strip() for x in os.environ.get('ZHIXING_ORIGINS', '').split(',') if x.strip()])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=os.environ.get('ZHIXING_DB', './zhixing.sqlite3'))
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--create-user')
    group.add_argument('--revoke-user')
    args = parser.parse_args()
    if args.create_user:
        print(create_user(args.db, args.create_user))
    else:
        initialize(args.db)
        with closing(connect(args.db)) as db, db:
            result = db.execute('DELETE FROM learners WHERE name=?', (args.revoke_user,))
            print(f'已撤销 {result.rowcount} 个用户及其同步数据')
