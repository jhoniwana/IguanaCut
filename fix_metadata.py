#!/usr/bin/env python3
"""Proxy that saves video metadata on upload. Streams large files, no buffering."""

import json, os, shutil, http.server, urllib.request, urllib.error

STORAGE = "/home/jhon/lossless/storage"
VIDEOS_DIR = os.path.join(STORAGE, "videos")
GO = "http://127.0.0.1:8082"
PORT = 8080

os.makedirs(VIDEOS_DIR, exist_ok=True)

def is_stream_path(path):
    return ("/api/videos/" in path and "/stream" in path) \
        or "/api/outputs/" in path \
        or "/assets/" in path

class Proxy(http.server.BaseHTTPRequestHandler):
    def do_ANY(self):
        cl = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(cl) if cl else b""
        req = urllib.request.Request(GO + self.path, data=body, method=self.command)
        for k, v in self.headers.items():
            if k.lower() not in ("host", "content-length"):
                req.add_header(k, v)
        try:
            resp = urllib.request.urlopen(req)
            status, hdrs = resp.status, dict(resp.headers)
        except urllib.error.HTTPError as e:
            resp, status, hdrs = e, e.code, dict(e.headers)

        self.send_response(status)
        for k, v in hdrs.items():
            if k.lower() not in ("transfer-encoding", "connection"):
                self.send_header(k, v)

        if is_stream_path(self.path):
            # Stream large files - no buffering
            clen = hdrs.get("Content-Length")
            if clen:
                self.send_header("Content-Length", clen)
            self.end_headers()
            shutil.copyfileobj(resp, self.wfile)
        else:
            data = resp.read()
            if self.command == "POST" and self.path == "/api/videos/upload" and status == 201:
                try:
                    video = json.loads(data).get("video")
                    if video and video.get("id"):
                        p = os.path.join(VIDEOS_DIR, f"{video['id']}.json")
                        with open(p, "w") as f:
                            json.dump(video, f, indent=2, default=str)
                        print(f"[fix] saved metadata for {video['id']}")
                except Exception as e:
                    print(f"[fix] error: {e}")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    do_GET=do_POST=do_PUT=do_DELETE=do_HEAD=do_PATCH=do_ANY

from socketserver import ThreadingMixIn
class ThreadedProxy(ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True

print(f"[fix] proxy on :{PORT} → {GO}")
ThreadedProxy(("0.0.0.0", PORT), Proxy).serve_forever()
