#!/usr/bin/env python3

import cgi
import json
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).parent
PUBLIC = ROOT / "public"
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self):
        if self.path != "/api/upload-favicon":
            self.send_error(404, "Not found")
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self.send_error(400, "Expected multipart form data")
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
            },
        )

        file_item = form["logo"]
        if not file_item or not getattr(file_item, "filename", None):
            self._send_json(400, {"error": "No logo file provided."})
            return

        extension = Path(file_item.filename).suffix.lower()
        if extension not in ALLOWED_EXTENSIONS:
            self._send_json(400, {"error": "Unsupported file type."})
            return

        data = file_item.file.read()
        if not data:
            self._send_json(400, {"error": "Uploaded file is empty."})
            return

        PUBLIC.mkdir(exist_ok=True)

        favicon_path = PUBLIC / "favicon.png"
        favicon_path.write_bytes(data)

        if extension == ".svg":
            (PUBLIC / "favicon.svg").write_bytes(data)
            public_path = "/public/favicon.svg"
        elif extension == ".ico":
            (PUBLIC / "favicon.ico").write_bytes(data)
            public_path = "/public/favicon.ico"
        else:
            public_path = "/public/favicon.png"

        (PUBLIC / "apple-touch-icon.png").write_bytes(data)

        self._send_json(200, {"ok": True, "path": public_path})

    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    port = 3000
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"Serving on http://localhost:{port}")
    print(f"Favicon upload: http://localhost:{port}/public/")
    server.serve_forever()


if __name__ == "__main__":
    main()
