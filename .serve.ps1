import http.server
class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()
http.server.HTTPServer(('127.0.0.1', 9000), Handler).serve_forever()