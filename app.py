#!/usr/bin/env python3
"""Ephemeris local server. Python 3.10+, no pip dependencies.

Only site/ and the explicitly named APIs are served; Reference/ and local
recordings are never exposed as a directory listing. Not a public web server.
"""
from __future__ import annotations
import argparse
import json
import mimetypes
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from catalog import CatalogService, number

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"


class TrajectoryStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        self.points = []
        if path.exists():
            try:
                payload = json.loads(path.read_text())
                if isinstance(payload, list):
                    self.points = [self.validate(p) for p in payload[:10000]]
            except (ValueError, TypeError, OSError):
                self.points = []

    @staticmethod
    def validate(p):
        if not isinstance(p, dict):
            raise ValueError("A point must be an object with ra and dec")
        return {"ra": number(p.get("ra"), "ra", 0, 360) % 360,
                "dec": number(p.get("dec"), "dec", -90, 90)}

    def update(self, method, point=None):
        with self.lock:
            if method == "POST":
                if len(self.points) >= 10000:
                    raise ValueError("Trajectory limit reached (10,000 points)")
                self.points.append(self.validate(point))
            elif method == "DELETE":
                self.points = []
            if method != "GET":
                self.path.parent.mkdir(parents=True, exist_ok=True)
                tmp = self.path.with_suffix(".tmp")
                tmp.write_text(json.dumps(self.points))
                os.replace(tmp, self.path)
            return list(self.points)


def make_handler(catalog=None, store=None):
    catalog = catalog or CatalogService(SITE / "data" / "seed.json")
    store = store or TrajectoryStore(ROOT / ".local" / "trajectory.json")

    class Handler(BaseHTTPRequestHandler):
        def respond(self, status, body, mime="application/json; charset=utf-8"):
            if not isinstance(body, bytes):
                body = json.dumps(body, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cache-Control", "no-store" if mime.startswith("application/json") else "no-cache")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            url = urlsplit(self.path)
            try:
                if url.path == "/api/health":
                    return self.respond(200, {"ok": True, "version": "0.1.0", "catalog": "SIMBAD"})
                if url.path == "/api/catalog":
                    q = parse_qs(url.query)
                    result = catalog.get(q.get("ra", [56.75])[0], q.get("dec", [24.1167])[0],
                        q.get("radius", [5])[0], q.get("limit", [300])[0], q.get("mag_limit", [12])[0])
                    return self.respond(200, result)
                if url.path == "/api/trajectory":
                    return self.respond(200, store.update("GET"))
                if url.path.startswith("/api/"):
                    return self.respond(404, {"error": "Unknown API route"})
                name = unquote(url.path).lstrip("/") or "index.html"
                if name.startswith("site/"):
                    name = name[5:]
                path = (SITE / name).resolve()
                if SITE.resolve() not in path.parents or not path.is_file():
                    return self.respond(404, {"error": "Not found"})
                mime = "text/javascript" if path.suffix in {".js", ".mjs"} else mimetypes.guess_type(path)[0] or "application/octet-stream"
                return self.respond(200, path.read_bytes(), mime)
            except ValueError as exc:
                self.respond(400, {"error": str(exc)})
            except Exception:
                self.respond(500, {"error": "Local server error; see terminal and check the bundled catalogue."})

        def mutate(self):
            if urlsplit(self.path).path != "/api/trajectory":
                return self.respond(404, {"error": "Unknown API route"})
            origin = self.headers.get("Origin")
            if origin and urlsplit(origin).netloc != self.headers.get("Host"):
                return self.respond(403, {"error": "Cross-origin writes are not allowed"})
            try:
                body = None
                if self.command == "POST":
                    if not self.headers.get("Content-Type", "").startswith("application/json"):
                        return self.respond(415, {"error": "Use application/json"})
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 4096:
                        return self.respond(413, {"error": "A point request must be at most 4096 bytes"})
                    body = json.loads(self.rfile.read(length))
                self.respond(200, store.update(self.command, body))
            except (ValueError, TypeError) as exc:
                self.respond(400, {"error": str(exc)})
            except OSError:
                self.respond(500, {"error": "Could not save local trajectory"})

        do_POST = mutate
        do_DELETE = mutate
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler())
    print(f"Ephemeris / Stargaze → http://127.0.0.1:{args.port}", flush=True)
    print("Open in Chrome or Edge. Camera and MIDI remain off until enabled. Ctrl+C quits.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
