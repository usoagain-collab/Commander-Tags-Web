"""Save a grid of fake training photos with their corner targets drawn on, and time the generator.

Gold dot = the card's top-left, blue = the other corners, red ring = covered.
Writes data/synth_preview.jpg.

Run:  uv run python -I scripts/preview_synth.py [--n 24] [--seed 1]
"""

import argparse
import sys
import time
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from scanner.synth import Synth  # noqa: E402

CACHE = ML / "data" / "cache"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=24)
    p.add_argument("--seed", type=int, default=1)
    args = p.parse_args()
    cards = torch.from_numpy(np.load(CACHE / "cards_224.npy", mmap_mode="r")[:4000].copy()).pin_memory()
    bgs = torch.from_numpy(np.load(CACHE / "backgrounds.npy"))
    synth = Synth(cards, bgs, seed=args.seed)
    b = synth.batch(args.n)
    imgs = (b.image.permute(0, 2, 3, 1).cpu().numpy() * 255).astype(np.uint8)
    cols = 8
    h, w = imgs.shape[1], imgs.shape[2]
    sheet = Image.new("RGB", (cols * w, -(-args.n // cols) * h))
    for i in range(args.n):
        im = Image.fromarray(imgs[i])
        d = ImageDraw.Draw(im)
        if b.present[i] > 0:
            for k, (x, y) in enumerate(b.corners[i].tolist()):
                color = (227, 179, 65) if k == 0 else (74, 163, 255)
                d.ellipse([x - 4, y - 4, x + 4, y + 4], fill=color)
                if b.hidden[i, k] > 0:
                    d.ellipse([x - 8, y - 8, x + 8, y + 8], outline=(248, 81, 73), width=2)
        else:
            d.text((6, 6), "no card", fill=(255, 80, 80))
        sheet.paste(im, ((i % cols) * w, (i // cols) * h))
    out = ML / "data" / "synth_preview.jpg"
    sheet.save(out, quality=88)
    print(f"Wrote {out}")

    for _ in range(3):
        synth.batch(64)
    torch.cuda.synchronize()
    t = time.perf_counter()
    for _ in range(20):
        synth.batch(64)
    torch.cuda.synchronize()
    print(f"Generator: {20 * 64 / (time.perf_counter() - t):.0f} photos a second (384 x 256)")


if __name__ == "__main__":
    main()
