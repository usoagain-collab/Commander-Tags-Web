"""Fingerprint every printing with a trained recognizer: the catalog the scanner searches.

Writes next to the checkpoint:
- catalog.npy: (N, 128) float16, one fingerprint per picture, in the cache's order
  (about 28 MB for 115,000 pictures);
- catalog.csv: the cache's index (class, Scryfall id, face, oracle id, ...).

Run:  uv run python -I scripts/build_catalog.py runs/recog-v1/best.pt
"""

import argparse
import shutil
import sys
import time
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))

import numpy as np  # noqa: E402
import torch  # noqa: E402

from scanner.recog_data import CACHE, embed_cache  # noqa: E402
from scanner.recog_model import RecogNet  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("checkpoint")
    p.add_argument("--cpu", action="store_true")
    args = p.parse_args()
    dev = "cpu" if args.cpu or not torch.cuda.is_available() else "cuda"
    ck_path = Path(args.checkpoint)
    if not ck_path.is_absolute():
        ck_path = ML / ck_path
    ck = torch.load(ck_path, map_location=dev)
    cache = ck.get("cache", "recog_312")
    model = RecogNet(pretrained=False).to(dev).eval()
    model.load_state_dict(ck["model"])
    arr = np.load(CACHE / f"{cache}.npy", mmap_mode="r")
    n = len(arr)
    start = time.time()
    parts = []
    for i in range(0, n, 4096):
        parts.append(embed_cache(model, arr, np.arange(i, min(n, i + 4096)), dev).half())
        print(f"  {min(n, i + 4096):,} / {n:,}  {time.time() - start:.0f} s", flush=True)
    cat = torch.cat(parts).numpy()
    np.save(ck_path.parent / "catalog.npy", cat)
    shutil.copy(CACHE / f"{cache}.csv", ck_path.parent / "catalog.csv")
    print(f"Catalog: {cat.shape[0]:,} fingerprints, {cat.nbytes / 2**20:.1f} MB, {time.time() - start:.0f} s")


if __name__ == "__main__":
    main()
