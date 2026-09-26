from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
import os

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        redirects = {
            "/verify/legacy-offer": "/verify/shared-offer.html",
            "/verify/friendly-offer": "/verify/shared-offer.html",
        }

        if path in redirects:
            self.send_response(302)
            self.send_header("Location", redirects[path])
            self.end_headers()
            return

        if path in {
            "/verify/header-canonical-old.html",
            "/verify/header-canonical-new.html",
        }:
            body = (
                "<!doctype html><html><head><title>Header canonical target</title>"
                "</head><body><main><h1>Header canonical target</h1></main></body></html>"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header(
                "Link",
                '</verify/shared-canonical.html>; rel="canonical"',
            )
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/verify/access-restricted.html":
            body = (
                "<!doctype html><html><head><title>Access restricted</title></head>"
                "<body><h1>Request blocked</h1><p>Challenge / access denied fixture.</p></body></html>"
            ).encode("utf-8")
            self.send_response(403)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("X-Test-WAF", "challenge")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/locations/colchester":
            body = (
                "<!doctype html><html><head><title>Legacy Colchester URL missing</title></head>"
                "<body><main><h1>Not found</h1><p>Intentional 404 fixture for the server-side link.</p></main></body></html>"
            ).encode("utf-8")
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        working_locations = {
            "/locations/chelmsford": "Chelmsford drainage",
            "/locations/ipswich": "Ipswich drainage",
            "/areas/essex/colchester": "Colchester drainage",
        }

        if path in working_locations:
            title = working_locations[path]
            body = (
                "<!doctype html><html><head>"
                f"<title>{title}</title>"
                f'<link rel="canonical" href="{path}">'
                "</head><body><main>"
                f"<h1>{title}</h1>"
                "<p>Controlled working location destination.</p>"
                "</main></body></html>"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    print(f"Nano SEO Lab honeypot: http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
