"""Development-only static preview; serves exactly the same _site deployed to Pages."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent


class PreviewServer(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


class Handler(SimpleHTTPRequestHandler):
    prefix = ''

    def do_GET(self):
        if self.rebase():
            super().do_GET()

    def do_HEAD(self):
        if self.rebase():
            super().do_HEAD()

    def rebase(self):
        path = urlsplit(self.path).path
        if self.prefix and path == self.prefix:
            self.send_response(308)
            self.send_header('Location', self.prefix + '/')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return False
        if self.prefix and not path.startswith(self.prefix + '/'):
            self.send_error(404)
            return False
        if self.prefix:
            self.path = self.path[len(self.prefix):]
        return True

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4188)
    parser.add_argument('--prefix', default='')
    args = parser.parse_args()
    if not (ROOT / '_site/index.html').exists():
        parser.error('请先运行 python scripts/build_static.py')
    Handler.prefix = '/' + args.prefix.strip('/') if args.prefix.strip('/') else ''
    server = PreviewServer(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT / '_site')))
    print(f'知行学习: http://127.0.0.1:{server.server_address[1]}{Handler.prefix}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
