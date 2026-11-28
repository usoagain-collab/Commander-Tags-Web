"""Measure how a corner finder misses on David's labeled frames, as the recognizer sees it.

For each labeled frame: run the corner finder, flatten with its corners, and
work out where the card's real corners (the labels) land in that flat
312 x 224 picture. The offsets from the picture's own corners, in units of
the card's width, are exactly what RecogSynth.misplace() makes up for its
fakes, so the recognizer can train on misses the size and shape of real ones.

Writes data/corner_errors.npy: (frames, 4, 2) float32, card's own top-left
first, clockwise; x and y in card widths. Also prints the size of the misses.

Run:
  uv run python -I scripts/corner_errors.py runs/corners-v2/best.pt
  uv run python -I scripts/corner_errors.py runs/corners-v2/best.pt --passes 1
"""

import argparse
import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))
sys.path.insert(0, str(ML / "scripts"))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from kornia.geometry.transform import get_perspective_transform  # noqa: E402
from PIL import Image  # noqa: E402

from eval_recognizer import corner_quads  # noqa: E402
from scanner.recog_data import DATA  # noqa: E402
from scanner.straighten import CARD_H, CARD_W  # noqa: E402


def landing(pred: torch.Tensor, truth: torch.Tensor) -> torch.Tensor:
    """Where the true corners land (4, 2, pixels of the flat card) when flattening with pred."""
    rect = torch.tensor([[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]], dtype=torch.float64)
    M = get_perspective_transform(pred[None].double(), rect[None])[0]
    p = torch.cat([truth.double(), torch.ones(4, 1, dtype=torch.float64)], 1) @ M.T
    return (p[:, :2] / p[:, 2:]).float()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("checkpoint")
    p.add_argument("--passes", type=int, default=2)
    p.add_argument("--out", default=str(DATA / "corner_errors.npy"))
    args = p.parse_args()
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    ck = Path(args.checkpoint)
    quads = corner_quads(ck if ck.is_absolute() else ML / ck, args.passes, dev)
    labels = json.loads((DATA / "labels" / "labels.json").read_text(encoding="utf-8"))
    rect = torch.tensor([[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]]).float()
    errs = []
    for name, lab in sorted(labels.items()):
        if lab.get("skip") or "corners" not in lab or name not in quads:
            continue
        with Image.open(DATA / "frames" / "cards" / name) as im:
            W, H = im.size
        truth = torch.tensor(lab["corners"]) * torch.tensor([W, H])
        errs.append(((landing(quads[name], truth) - rect) / CARD_W).numpy())
    e = np.stack(errs).astype(np.float32)
    np.save(args.out, e)
    d = np.linalg.norm(e, axis=2)
    print(f"{len(e)} frames, {args.passes} pass(es). Corner miss in card widths (flat picture):")
    print(f"  per corner: median {np.median(d):.3f}, 90% {np.percentile(d, 90):.3f}, max {d.max():.3f}")
    print(f"  per frame (mean of 4): median {np.median(d.mean(1)):.3f}, 90% {np.percentile(d.mean(1), 90):.3f}")
    print(f"  shared shift (mean offset): median {np.median(np.linalg.norm(e.mean(1), axis=1)):.3f}")
    print(f"Saved {args.out}")


if __name__ == "__main__":
    main()
