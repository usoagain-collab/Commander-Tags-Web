"""Pack card pictures and backgrounds into two arrays for fast training.

- data/cache/cards_<h>.npy: a random sample of card pictures (front and back
  faces), resized to <h> x <h*0.716> pixels, uint8 (N, H, W, 3).
- data/cache/backgrounds.npy: every frame in data/backgrounds, resized to
  632 x 400 (portrait), uint8 (M, 632, 400, 3).

The corner finder doesn't need every printing (it learns card outlines, not
which card), so a sample keeps memory in check: 30,000 cards at 224 px is
about 3.2 GB.

Run:  uv run python -I scripts/build_cache.py [--cards 30000] [--height 224]
"""

import argparse
import csv
import random
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

DATA = Path(__file__).resolve().parent.parent / "data"
CACHE = DATA / "cache"


def image_path(row: dict) -> Path:
    suffix = "" if row["face"] == "0" else f"_{row['face']}"
    return DATA / "images" / row["id"][:2] / f"{row['id']}{suffix}.jpg"


def load(args) -> np.ndarray:
    path, size = args
    with Image.open(path) as im:
        return np.asarray(im.convert("RGB").resize(size, Image.BILINEAR))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cards", type=int, default=30000)
    parser.add_argument("--height", type=int, default=224)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)

    with open(DATA / "manifest.csv", encoding="utf-8", newline="") as f:
        rows = [r for r in csv.DictReader(f) if image_path(r).exists()]
    random.Random(args.seed).shuffle(rows)
    rows = rows[: args.cards]
    h = args.height
    w = round(h * 63 / 88)
    with ProcessPoolExecutor() as pool:
        cards = np.stack(list(pool.map(load, [(image_path(r), (w, h)) for r in rows], chunksize=256)))
    np.save(CACHE / f"cards_{h}.npy", cards)
    with open(CACHE / f"cards_{h}.csv", "w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows([[r["id"], r["face"], r["name"]] for r in rows])
    print(f"cards: {cards.shape}, {cards.nbytes / 2**30:.2f} GB")

    bgs = sorted((DATA / "backgrounds").glob("*.jpg"))
    with ProcessPoolExecutor() as pool:
        backgrounds = np.stack(list(pool.map(load, [(p, (400, 632)) for p in bgs], chunksize=16)))
    np.save(CACHE / "backgrounds.npy", backgrounds)
    print(f"backgrounds: {backgrounds.shape}, {backgrounds.nbytes / 2**20:.0f} MB")


if __name__ == "__main__":
    main()
