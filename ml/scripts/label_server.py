"""A small labeling page for David's card frames, served on this laptop only.

Open http://localhost:8765 after starting it. For each frame you tap the card's
4 corners and pick the printing from the downloaded Scryfall pictures. Every
save goes straight to data/labels/labels.json (with a backup of the previous
version), so closing the page or the server loses nothing.

Run:  uv run python -I scripts/label_server.py [--port 8765] [--phone]

--phone also serves the page on the home Wi-Fi so a phone can open it. The
address it prints carries a short code; requests without it are refused, so
nobody else on the network can read or change the labels.
"""

import argparse
import csv
import json
import re
import secrets
import shutil
import socket
import threading
import time
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ML = Path(__file__).resolve().parent.parent
DATA = ML / "data"
FRAMES = DATA / "frames" / "cards"
IMAGES = DATA / "images"
LABELS = DATA / "labels" / "labels.json"
PAGE = Path(__file__).resolve().parent / "label_page.html"

FRAME_NAME = re.compile(r"^[\w.-]+\.jpg$")
IMAGE_NAME = re.compile(r"^([0-9a-f-]{36})(?:_(\d))?\.jpg$")

lock = threading.Lock()
TOKEN: str | None = None  # set with --phone


def load_manifest():
    by_name: dict[str, list[dict]] = {}
    with open(DATA / "manifest.csv", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            by_name.setdefault(row["name"], []).append({
                k: row[k] for k in ("id", "face", "set", "collector_number", "lang",
                                    "released_at", "finishes", "frame", "border_color", "name")
            })
    for rows in by_name.values():
        rows.sort(key=lambda r: (r["released_at"], r["set"], r["collector_number"]), reverse=True)
    names = sorted(by_name)
    lowered = [(n.lower(), n) for n in names]
    return by_name, lowered


BY_NAME, LOWERED = load_manifest()


def read_labels() -> dict:
    if LABELS.exists():
        return json.loads(LABELS.read_text(encoding="utf-8"))
    return {}


def write_labels(labels: dict) -> None:
    LABELS.parent.mkdir(parents=True, exist_ok=True)
    if LABELS.exists():
        shutil.copyfile(LABELS, LABELS.with_suffix(".backup.json"))
    tmp = LABELS.with_suffix(".part")
    tmp.write_text(json.dumps(labels, indent=1, sort_keys=True), encoding="utf-8")
    tmp.replace(LABELS)


def clean_label(body: dict) -> dict:
    """Keep only the fields we expect, with sane types."""
    out: dict = {"saved_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    if body.get("skip"):
        out["skip"] = True
        out["note"] = str(body.get("note", ""))[:200]
        return out
    corners = body.get("corners")
    if not (isinstance(corners, list) and len(corners) == 4):
        raise ValueError("need 4 corners")
    out["corners"] = [[round(min(1.0, max(0.0, float(x))), 5), round(min(1.0, max(0.0, float(y))), 5)]
                      for x, y in corners]
    hidden = body.get("hidden") or [False] * 4
    out["hidden"] = [bool(h) for h in hidden[:4]] + [False] * (4 - len(hidden[:4]))
    p = body.get("printing")
    if p:
        out["printing"] = {"id": str(p["id"]), "face": int(p.get("face", 0)),
                           "name": str(p.get("name", "")), "set": str(p.get("set", "")),
                           "collector_number": str(p.get("collector_number", ""))}
    out["foil"] = bool(body.get("foil"))
    out["sleeved"] = bool(body.get("sleeved"))
    out["note"] = str(body.get("note", ""))[:200]
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # keep the window quiet
        pass

    def send_json(self, data, status=HTTPStatus.OK):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, ctype: str):
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=86400" if ctype == "image/jpeg" else "no-store")
        self.end_headers()
        self.wfile.write(data)

    def allowed(self, q: dict) -> bool:
        if TOKEN is None:
            return True
        cookie = self.headers.get("Cookie", "")
        return (q.get("k") or [""])[0] == TOKEN or f"lk={TOKEN}" in cookie.replace(" ", "").split(";")

    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        path = unquote(url.path)
        if not self.allowed(q):
            return self.send_error(HTTPStatus.FORBIDDEN, "Open the address with the code the server printed")
        if path == "/":
            if TOKEN and (q.get("k") or [""])[0] == TOKEN:
                data = PAGE.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Set-Cookie", f"lk={TOKEN}; Path=/; SameSite=Strict; Max-Age=2592000")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
                return
            return self.send_file(PAGE, "text/html; charset=utf-8")
        if path == "/api/frames":
            labels = read_labels()
            frames = sorted(p.name for p in FRAMES.glob("*.jpg"))
            return self.send_json([{"name": f, "label": labels.get(f)} for f in frames])
        if path.startswith("/frames/"):
            name = path[len("/frames/"):]
            if not FRAME_NAME.match(name):
                return self.send_error(HTTPStatus.BAD_REQUEST)
            return self.send_file(FRAMES / name, "image/jpeg")
        if path.startswith("/img/"):
            m = IMAGE_NAME.match(path[len("/img/"):])
            if not m:
                return self.send_error(HTTPStatus.BAD_REQUEST)
            card_id, face = m.group(1), m.group(2)
            return self.send_file(IMAGES / card_id[:2] / (card_id + (f"_{face}" if face else "") + ".jpg"),
                                  "image/jpeg")
        if path == "/api/names":
            text = (q.get("q") or [""])[0].strip().lower()
            if len(text) < 2:
                return self.send_json([])
            starts = [n for low, n in LOWERED if low.startswith(text)]
            contains = [n for low, n in LOWERED if text in low and not low.startswith(text)]
            hits = (starts + contains)[:20]
            return self.send_json([{"name": n, "count": len(BY_NAME[n])} for n in hits])
        if path == "/api/printings":
            name = (q.get("name") or [""])[0]
            return self.send_json(BY_NAME.get(name, []))
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self):
        url = urlparse(self.path)
        if not self.allowed(parse_qs(url.query)):
            return self.send_error(HTTPStatus.FORBIDDEN)
        if url.path != "/api/label":
            return self.send_error(HTTPStatus.NOT_FOUND)
        length = int(self.headers.get("Content-Length", "0"))
        if length > 100_000:
            return self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        try:
            body = json.loads(self.rfile.read(length))
            frame = str(body["frame"])
            if not FRAME_NAME.match(frame) or not (FRAMES / frame).is_file():
                raise ValueError("unknown frame")
            with lock:
                labels = read_labels()
                if body.get("clear"):
                    labels.pop(frame, None)
                else:
                    labels[frame] = clean_label(body)
                write_labels(labels)
            return self.send_json({"ok": True, "label": labels.get(frame)})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            return self.send_json({"ok": False, "error": str(e)}, HTTPStatus.BAD_REQUEST)


def lan_ip() -> str:
    """This laptop's address on the home network (no data is sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "this-laptop's-IP"
    finally:
        s.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--phone", action="store_true", help="also serve on the home Wi-Fi, with a code")
    args = parser.parse_args()
    global TOKEN
    host = "127.0.0.1"
    if args.phone:
        alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
        TOKEN = "".join(secrets.choice(alphabet) for _ in range(6))
        host = "0.0.0.0"
    server = ThreadingHTTPServer((host, args.port), Handler)
    url = f"http://localhost:{args.port}" + (f"/?k={TOKEN}" if TOKEN else "")
    frames = len(list(FRAMES.glob("*.jpg")))
    print(f"Labeling {frames} frames at {url} (Ctrl+C to stop). Labels: {LABELS}")
    if args.phone:
        print()
        print(f"  On your phone (same Wi-Fi), open:  http://{lan_ip()}:{args.port}/?k={TOKEN}")
        print("  If Windows asks whether Python may use the network, allow Private networks.")
        print()
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
