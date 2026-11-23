"""Download every picture in ml/data/manifest.csv, shrunk to 320 px tall.

- Saves JPEGs as ml/data/images/<first 2 letters of id>/<id>[_<face>].jpg
  (face 0 has no suffix; the back of a double-faced card is <id>_1.jpg).
- Resumable: pictures already on disk are skipped, so stopping it (Ctrl+C,
  closing the window, a reboot) and running it again carries on.
- At most 10 requests a second (Scryfall's guideline), with a descriptive
  User-Agent. A picture that fails 4 times is written to
  ml/data/images_failed.csv; running the script again retries those.
- Progress goes to the screen and to ml/data/download_images.log.

Run:  uv run python -I scripts/download_images.py [--rate 10] [--limit N]
"""

import argparse
import csv
import io
import queue
import threading
import time
from pathlib import Path

import requests
from PIL import Image

ML = Path(__file__).resolve().parent.parent
DATA = ML / "data"
MANIFEST = DATA / "manifest.csv"
IMAGES = DATA / "images"
FAILED = DATA / "images_failed.csv"
LOG = DATA / "download_images.log"

USER_AGENT = "DeckGenomeScannerML/0.1 (deckgenome.com; card scanner training data)"
HEIGHT = 320
WORKERS = 8
TRIES = 4


def image_path(row: dict) -> Path:
    suffix = "" if str(row["face"]) == "0" else f"_{row['face']}"
    return IMAGES / row["id"][:2] / f"{row['id']}{suffix}.jpg"


class RateLimiter:
    """Hands out at most `rate` start times per second across all threads."""

    def __init__(self, rate: float):
        self.gap = 1.0 / rate
        self.next = time.monotonic()
        self.lock = threading.Lock()

    def wait(self) -> None:
        with self.lock:
            now = time.monotonic()
            start = max(now, self.next)
            self.next = start + self.gap
        if start > now:
            time.sleep(start - now)


def fetch(session: requests.Session, limiter: RateLimiter, row: dict) -> str | None:
    """Download, shrink and save one picture. Returns None on success, else the error."""
    error = "unknown"
    for attempt in range(TRIES):
        limiter.wait()
        try:
            r = session.get(row["image_url"], timeout=30)
            if r.status_code == 200:
                img = Image.open(io.BytesIO(r.content)).convert("RGB")
                width = round(img.width * HEIGHT / img.height)
                img = img.resize((width, HEIGHT), Image.LANCZOS)
                out = image_path(row)
                out.parent.mkdir(parents=True, exist_ok=True)
                tmp = out.with_suffix(".part")
                img.save(tmp, "JPEG", quality=90)
                tmp.replace(out)
                return None
            error = f"HTTP {r.status_code}"
            if r.status_code == 404:
                return error
            if r.status_code == 429:
                time.sleep(30)
        except Exception as e:  # network trouble or a broken picture
            error = f"{type(e).__name__}: {e}"
        time.sleep(2 ** attempt)
    return error


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rate", type=float, default=10, help="requests per second (at most 10)")
    parser.add_argument("--limit", type=int, default=0, help="stop after this many downloads (testing)")
    args = parser.parse_args()
    rate = min(args.rate, 10)

    with open(MANIFEST, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    todo = [r for r in rows if not image_path(r).exists()]
    have = len(rows) - len(todo)
    if args.limit:
        todo = todo[: args.limit]

    log = open(LOG, "a", encoding="utf-8")

    def say(msg: str) -> None:
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
        print(line, flush=True)
        log.write(line + "\n")
        log.flush()

    say(f"{len(rows):,} pictures in the manifest, {have:,} already on disk, "
        f"{len(todo):,} to download at up to {rate:g} a second "
        f"(about {len(todo) / rate / 3600:.1f} hours)")
    if not todo:
        if FAILED.exists():
            FAILED.unlink()
        return

    work: queue.Queue = queue.Queue()
    for r in todo:
        work.put(r)
    limiter = RateLimiter(rate)
    lock = threading.Lock()
    failures: list[tuple[dict, str]] = []
    done = 0
    start = time.monotonic()

    def worker() -> None:
        nonlocal done
        session = requests.Session()
        session.headers["User-Agent"] = USER_AGENT
        while True:
            try:
                row = work.get_nowait()
            except queue.Empty:
                return
            err = fetch(session, limiter, row)
            with lock:
                done += 1
                if err:
                    failures.append((row, err))
                    say(f"failed {row['id']} face {row['face']} ({row['name']}): {err}")
                if done % 500 == 0:
                    spent = time.monotonic() - start
                    left = (len(todo) - done) * spent / done
                    say(f"{done:,} / {len(todo):,} done, {len(failures)} failed, "
                        f"{done / spent:.1f} a second, about {left / 3600:.1f} hours left")

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(WORKERS)]
    for t in threads:
        t.start()
    try:
        for t in threads:
            while t.is_alive():
                t.join(1)
    except KeyboardInterrupt:
        say("Stopped by hand; run the script again to carry on.")
        raise SystemExit(1)

    with open(FAILED, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "face", "name", "image_url", "error"])
        for row, err in failures:
            w.writerow([row["id"], row["face"], row["name"], row["image_url"], err])
    spent = time.monotonic() - start
    say(f"Finished: {done - len(failures):,} downloaded, {len(failures)} failed "
        f"(listed in {FAILED.name}; run again to retry), {spent / 3600:.1f} hours")


if __name__ == "__main__":
    main()
