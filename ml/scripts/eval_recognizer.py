"""Score the recognizer on David's labeled frames against the whole catalog (phase 3 go / no-go).

For each labeled frame: flatten the card (with the labeled corners, or with
the corner finder's when --corners is given, which is the whole scanner minus
the phone), fingerprint it and find the closest printing in catalog.npy.

Prints:
- right card / right artwork / right printing, first guess and in the top 5;
- how sure it was: the gap between the best and second-best *card*. When the
  gap is small the scanner should ask instead of guessing, so for a few gap
  thresholds it shows how many it would add on its own and how many of those
  would be wrong (the go / no-go: under 1% wrong and confident);
- every miss, with what it guessed.

Run (after build_catalog.py):
  uv run python -I scripts/eval_recognizer.py runs/recog-v1/best.pt
  uv run python -I scripts/eval_recognizer.py runs/recog-v1/best.pt --corners runs/corners-v2/best.pt
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
from PIL import Image  # noqa: E402

from scanner.corner_model import CornerNet  # noqa: E402
from scanner.recog_data import DATA, embed, real_frames  # noqa: E402
from scanner.recog_model import RecogNet  # noqa: E402
from scanner.refine import find_corners  # noqa: E402


def corner_quads(ckpt: Path, passes: int, dev) -> dict:
    model = CornerNet(pretrained=False).to(dev).eval()
    model.load_state_dict(torch.load(ckpt, map_location=dev)["model"])
    labels = json.loads((DATA / "labels" / "labels.json").read_text(encoding="utf-8"))
    out = {}
    for name in labels:
        path = DATA / "frames" / "cards" / name
        if not path.exists():
            continue
        with Image.open(path) as im:
            t = torch.from_numpy(np.asarray(im.convert("RGB")).copy()).permute(2, 0, 1).float().div(255).to(dev)
        out[name] = find_corners(model, t, passes)[-1]["corners"].cpu()
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("checkpoint")
    p.add_argument("--corners", help="a corner finder checkpoint: flatten with its corners instead of the labels")
    p.add_argument("--passes", type=int, default=2)
    p.add_argument("--cpu", action="store_true")
    args = p.parse_args()
    dev = "cpu" if args.cpu or not torch.cuda.is_available() else "cuda"
    ck_path = Path(args.checkpoint)
    if not ck_path.is_absolute():
        ck_path = ML / ck_path
    folder = ck_path.parent
    cat = torch.from_numpy(np.load(folder / "catalog.npy").astype(np.float32))
    with open(folder / "catalog.csv", encoding="utf-8", newline="") as f:
        index = list(csv.DictReader(f))
    classes = {(r["id"], r["face"]): int(r["cls"]) for r in index}
    oracle = np.array([r["oracle_id"] for r in index])
    art = np.array([r["illustration_id"] or r["id"] for r in index])

    model = RecogNet(pretrained=False).to(dev).eval()
    model.load_state_dict(torch.load(ck_path, map_location=dev)["model"])
    quads = None
    if args.corners:
        cp = Path(args.corners)
        quads = corner_quads(cp if cp.is_absolute() else ML / cp, args.passes, dev)
    real = real_frames(classes, quads)
    if real is None:
        print("No labeled frames with a printing in the catalog.")
        return
    imgs, truth, names = real
    q = embed(model, imgs, dev)
    sim = q @ cat.T
    top = sim.topk(min(50, sim.shape[1]), dim=1)
    t = truth.numpy()
    first = top.indices[:, 0].numpy()
    top5 = top.indices[:, :5].numpy()

    # how sure: best score minus the best score of a different card
    gaps = []
    for i in range(len(t)):
        o = oracle[first[i]]
        other = next((s for s, j in zip(top.values[i].tolist(), top.indices[i].tolist()) if oracle[j] != o), None)
        gaps.append(top.values[i, 0].item() - (other if other is not None else -1))
    gaps = np.array(gaps)
    card_ok = oracle[first] == oracle[t]

    n = len(t)
    print(f"{n} labeled frames, catalog of {len(cat):,}, corners from {'the corner finder' if quads else 'the labels'}")
    print(f"  right card:     {card_ok.mean():.1%}  (top 5: {np.mean([oracle[t[i]] in oracle[top5[i]] for i in range(n)]):.1%})")
    print(f"  right artwork:  {(art[first] == art[t]).mean():.1%}")
    print(f"  right printing: {(first == t).mean():.1%}  (top 5: {np.mean([t[i] in top5[i] for i in range(n)]):.1%})")
    print("  go / no-go: card 98%+, printing 90%+ from the picture alone, under 1% wrong and confident")
    print("  if it only adds cards on its own when the gap to the next card is at least:")
    for g in (0.02, 0.05, 0.1, 0.15, 0.2):
        sure = gaps >= g
        wrong = (~card_ok & sure).sum()
        print(f"    {g:.2f}: adds {sure.mean():.0%} on its own, {wrong} of those wrong ({wrong / max(1, n):.1%} of all)")
    misses = [i for i in range(n) if first[i] != t[i]]
    if misses:
        print("Misses (frame: truth -> guess, gap):")
        for i in misses:
            a, b = index[t[i]], index[first[i]]
            kind = "printing" if oracle[first[i]] == oracle[t[i]] else "CARD"
            print(f"  {names[i]}: {a['name']} ({a['set']} {a['collector_number']}) -> "
                  f"{b['name']} ({b['set']} {b['collector_number']})  [{kind}] gap {gaps[i]:.3f}")


if __name__ == "__main__":
    main()
