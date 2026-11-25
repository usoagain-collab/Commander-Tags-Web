"""Score a corner finder on David's labeled frames, with and without the zoomed-in second pass.

For every labeled frame in data/labels/labels.json it runs pass 1 (whole frame)
and the later passes (a crop around the previous answer, cut from the full-size
frame; see scanner/refine.py), and prints for each pass the go / no-go numbers
from docs/scanner-model-spec.md: mean and median corner error as a share of the
card's width, and the share of frames within 2% and 4%.

Also writes, next to the checkpoint:
- eval_<passes>.csv: per frame, the error after each pass;
- eval_worst.jpg: the 12 worst frames after the last pass (label green,
  pass 1 red, last pass gold; the dot marks the card's own top-left).

Run:  uv run python -I scripts/eval_corners.py runs/corners-v2/best.pt [--passes 3] [--cpu]
"""

import argparse
import csv
import json
import sys
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from scanner.corner_model import CornerNet, corner_error  # noqa: E402
from scanner.refine import find_corners  # noqa: E402

DATA = ML / "data"


def labeled_frames():
    labels = json.loads((DATA / "labels" / "labels.json").read_text(encoding="utf-8"))
    for name, lab in sorted(labels.items()):
        if lab.get("skip") or "corners" not in lab:
            continue
        path = DATA / "frames" / "cards" / name
        if path.exists():
            yield name, path, lab


def load(path: Path) -> Image.Image:
    with Image.open(path) as im:
        return im.convert("RGB")


def summary(err: torch.Tensor) -> str:
    return (f"mean {err.mean():.2%}  median {err.median():.2%}  "
            f"within 2% {(err < 0.02).float().mean():.0%}  within 4% {(err < 0.04).float().mean():.0%}")


def draw_quad(d: ImageDraw.ImageDraw, q, color, width=4):
    pts = [tuple(p) for p in q]
    d.line(pts + [pts[0]], fill=color, width=width)
    x, y = pts[0]
    d.ellipse([x - 9, y - 9, x + 9, y + 9], outline=color, width=width)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("checkpoint")
    p.add_argument("--passes", type=int, default=3)
    p.add_argument("--cpu", action="store_true")
    args = p.parse_args()
    dev = "cpu" if args.cpu or not torch.cuda.is_available() else "cuda"

    ck_path = Path(args.checkpoint)
    if not ck_path.is_absolute():
        ck_path = ML / ck_path
    model = CornerNet(pretrained=False).to(dev).eval()
    model.load_state_dict(torch.load(ck_path, map_location=dev)["model"])

    rows, errs, worst = [], [[] for _ in range(args.passes)], []
    for name, path, lab in labeled_frames():
        im = load(path)
        if im.width > im.height:
            continue  # the model is portrait; no landscape frames so far
        W, H = im.size
        img = torch.from_numpy(np.asarray(im).copy()).permute(2, 0, 1).float().div(255).to(dev)
        truth = torch.tensor(lab["corners"]) * torch.tensor([W, H])
        outs = find_corners(model, img, args.passes)
        row = {"frame": name}
        for k, o in enumerate(outs):
            e = corner_error(o["corners"].cpu()[None], truth[None]).mean().item()
            errs[k].append(e)
            row[f"pass{k + 1}"] = round(e, 4)
        rows.append(row)
        worst.append((errs[-1][-1], path, truth, outs[0]["corners"].cpu(), outs[-1]["corners"].cpu()))

    if not rows:
        print("No labeled portrait frames found in data/labels/labels.json")
        return
    print(f"{len(rows)} labeled frames, checkpoint {ck_path}")
    for k in range(args.passes):
        e = torch.tensor(errs[k])
        print(f"  pass {k + 1}: {summary(e)}")
    print("  go / no-go: mean under 2%, 95% within 4%")

    out_csv = ck_path.parent / f"eval_{args.passes}.csv"
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    worst.sort(key=lambda t: -t[0])
    tiles = []
    for e, path, truth, first, last in worst[:12]:
        im = load(path)
        d = ImageDraw.Draw(im)
        draw_quad(d, truth.tolist(), (60, 220, 90))
        draw_quad(d, first.tolist(), (230, 60, 60))
        draw_quad(d, last.tolist(), (240, 190, 40))
        d.text((20, 20), f"{path.name}  {e:.1%}", fill=(255, 255, 255))
        im.thumbnail((400, 640))
        tiles.append(im)
    if tiles:
        tw, th = 400, 640
        sheet = Image.new("RGB", (tw * 4, th * ((len(tiles) + 3) // 4)), (20, 20, 20))
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % 4) * tw, (i // 4) * th))
        sheet.save(ck_path.parent / "eval_worst.jpg", quality=88)
    print(f"Per frame: {out_csv}\nWorst frames: {ck_path.parent / 'eval_worst.jpg'}")


if __name__ == "__main__":
    main()
