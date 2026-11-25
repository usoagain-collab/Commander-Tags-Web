"""Pack every card picture into one big array for training the card recognizer.

- data/cache/recog_312.npy: (N, 312, 224, 3) uint8, every picture in the
  manifest that was downloaded (about 115,000, about 24 GB on disk). Training
  reads it as a memory-mapped file, so it never has to fit in memory.
- data/cache/recog_312.csv: one row per picture in the same order: its class
  number (= row number), Scryfall id, face, oracle id, illustration id, name,
  set, collector number, language.

The corner finder's cache (build_cache.py) only samples 30,000 cards; the
recognizer needs every printing, because every printing is its own class.

Run:  uv run python -I scripts/build_recog_cache.py [--limit 2000]   (limit: a small test cache)
"""

import argparse
import csv
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

DATA = Path(__file__).resolve().parent.parent / "data"
CACHE = DATA / "cache"
H, W = 312, 224
COLUMNS = ["cls", "id", "face", "oracle_id", "illustration_id", "name", "set", "collector_number", "lang"]


def image_path(row: dict) -> Path:
    suffix = "" if row["face"] == "0" else f"_{row['face']}"
    return DATA / "images" / row["id"][:2] / f"{row['id']}{suffix}.jpg"


def load(path: Path) -> np.ndarray:
    try:
        with Image.open(path) as im:
            return np.asarray(im.convert("RGB").resize((W, H), Image.BILINEAR))
    except OSError:
        return np.zeros((H, W, 3), np.uint8)   # a broken download; listed below


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=0, help="only the first N pictures (a quick test)")
    p.add_argument("--name", default="recog_312")
    args = p.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)

    with open(DATA / "manifest.csv", encoding="utf-8", newline="") as f:
        rows = [r for r in csv.DictReader(f) if image_path(r).exists()]
    if args.limit:
        rows = rows[: args.limit]
    n = len(rows)
    print(f"{n:,} pictures -> {n * H * W * 3 / 2**30:.1f} GB", flush=True)

    arr = np.lib.format.open_memmap(CACHE / f"{args.name}.npy", mode="w+", dtype=np.uint8, shape=(n, H, W, 3))
    start, broken = time.time(), []
    with ProcessPoolExecutor() as pool:
        for i, img in enumerate(pool.map(load, [image_path(r) for r in rows], chunksize=128)):
            arr[i] = img
            if not img.any():
                broken.append(rows[i]["id"])
            if (i + 1) % 10000 == 0:
                print(f"  {i + 1:,} / {n:,}  {time.time() - start:.0f} s", flush=True)
    arr.flush()
    del arr

    with open(CACHE / f"{args.name}.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(COLUMNS)
        for i, r in enumerate(rows):
            w.writerow([i, r["id"], r["face"], r["oracle_id"], r["illustration_id"], r["name"], r["set"],
                        r["collector_number"], r["lang"]])
    print(f"Done in {time.time() - start:.0f} s. {len(broken)} pictures could not be read"
          + (f" (first: {broken[:5]})" if broken else ""))


if __name__ == "__main__":
    main()
