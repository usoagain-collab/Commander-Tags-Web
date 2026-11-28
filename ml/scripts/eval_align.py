"""How well does lining up with the clean picture (scanner/align.py) fix the corner finder's corners?

For each labeled frame: start from corners-v2's corners, align to the card's
own clean picture, and measure the miss against the hand labels (in card
widths, as scripts/corner_errors.py does), before and after. Also aligns to
the closest wrong artwork (by untrained DINOv2) to see whether the match score
tells right from wrong.

Run:
  uv run python -I scripts/eval_align.py
"""

import json
import sys
import time
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))
sys.path.insert(0, str(ML / "scripts"))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402

from corner_errors import landing  # noqa: E402
from eval_recognizer import corner_quads  # noqa: E402
from scanner.align import align  # noqa: E402
from scanner.recog_data import CACHE, DATA, class_of, load_index  # noqa: E402
from scanner.straighten import CARD_H, CARD_W  # noqa: E402


def miss(pred: torch.Tensor, truth: torch.Tensor) -> float:
    r = torch.tensor([[0, 0], [CARD_W, 0], [CARD_W, CARD_H], [0, CARD_H]]).float()
    return float(((landing(pred.cpu(), truth) - r) / CARD_W).norm(dim=1).mean())


def main() -> None:
    dev = "cuda"
    index = load_index()
    classes = class_of(index)
    arr = np.load(CACHE / "recog_312.npy", mmap_mode="r")
    art = np.array([r["illustration_id"] or r["id"] + r["face"] for r in index])
    nn_ = torch.load(ML / "runs" / "dino-look-alikes.pt")
    labels = json.loads((DATA / "labels" / "labels.json").read_text(encoding="utf-8"))
    quads = corner_quads(ML / "runs" / "corners-v2" / "best.pt", 2, dev)

    def tmpl(c):
        return torch.from_numpy(np.ascontiguousarray(arr[c])).permute(2, 0, 1).float().div(255)

    rows = []
    t0 = time.time()
    for name, lab in sorted(labels.items()):
        pr = lab.get("printing") or {}
        key = (pr.get("id"), str(pr.get("face", 0)))
        if lab.get("skip") or "corners" not in lab or key not in classes or name not in quads:
            continue
        c = classes[key]
        with Image.open(DATA / "frames" / "cards" / name) as im:
            im = im.convert("RGB")
            W, H = im.size
            frame = torch.from_numpy(np.asarray(im).copy()).permute(2, 0, 1).float().div(255).to(dev)
        truth = torch.tensor(lab["corners"]) * torch.tensor([W, H])
        wrong = int(nn_[c, 0])
        corners, sc = align(frame, quads[name], torch.stack([tmpl(c), tmpl(wrong)]))
        hand_c, hand_s = align(frame, truth, tmpl(c)[None])
        rows.append((name, miss(quads[name], truth), miss(corners[0], truth), miss(hand_c[0], truth),
                     float(sc[0]), float(sc[1]), float(hand_s[0])))
    dt = (time.time() - t0) / max(1, len(rows))
    a = np.array([r[1:] for r in rows])
    print(f"{len(rows)} frames, {dt:.2f} s a frame (2 candidates + hand check)")
    for i, label in enumerate(["corners-v2", "corners-v2 + align to right card", "hand + align (label noise)"]):
        print(f"  {label:34s} miss per frame: median {np.median(a[:, i]):.3f}, 90% {np.percentile(a[:, i], 90):.3f}, "
              f"under 2%: {np.mean(a[:, i] < 0.02):.0%}")
    print(f"  match score: right card median {np.median(a[:, 3]):.3f}, wrong look-alike median {np.median(a[:, 4]):.3f}; "
          f"right beats wrong on {np.mean(a[:, 3] > a[:, 4]):.0%} of frames")
    worst = sorted(rows, key=lambda r: -r[2])[:8]
    print("Worst after align (frame, before, after, score right, score wrong):")
    for r in worst:
        print(f"  {r[0]}: {r[1]:.3f} -> {r[2]:.3f}  {r[4]:.3f} / {r[5]:.3f}")
    np.save(ML / "runs" / "align_eval.npy", a)


if __name__ == "__main__":
    main()
