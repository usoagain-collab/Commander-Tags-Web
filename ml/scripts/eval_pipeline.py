"""The whole single-frame recognizer on David's labeled frames: corners, guess, snap, re-check.

1. corners-v2 corners (2 passes), flatten, DINOv2 (+ head if given) fingerprint;
2. the top --k artworks in the catalog are the candidates;
3. for each candidate, snap the corners onto its clean picture (scanner/align.py),
   flatten again with the snapped corners and fingerprint again;
4. pick the candidate whose re-check scores best: fingerprint similarity to that
   candidate after snapping, plus --w times the picture match.

Prints right card for step 1 alone and for the full pipeline, how often it
would add a card on its own (gap to the runner-up) and how many of those are
wrong, and the corner miss after snapping to the chosen card.

Run:
  uv run python -I scripts/eval_pipeline.py
  uv run python -I scripts/eval_pipeline.py --head runs/dino-head-v1/head.pt --k 3
"""

import argparse
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

from eval_align import miss  # noqa: E402
from eval_recognizer import corner_quads  # noqa: E402
from scanner.align import align  # noqa: E402
from scanner.dino import features, load_backbone  # noqa: E402
from scanner.dino_head import DinoHead  # noqa: E402
from scanner.recog_data import CACHE, DATA, class_of, load_index  # noqa: E402
from scanner.straighten import straighten  # noqa: E402
from train_dino_head import clean_features  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--head", help="a trained head (runs/<name>/head.pt); none = untrained DINOv2 CLS")
    p.add_argument("--k", type=int, default=3, help="candidate artworks to snap and re-check")
    p.add_argument("--w", type=float, default=0.5, help="weight of the picture match in the re-check")
    p.add_argument("--corners", default="runs/corners-v2/best.pt")
    p.add_argument("--hand", action="store_true", help="start from the hand corners instead")
    args = p.parse_args()
    dev = "cuda"
    index = load_index()
    classes = class_of(index)
    oracle = np.array([r["oracle_id"] for r in index])
    art = np.array([r["illustration_id"] or r["id"] + r["face"] for r in index])
    arr = np.load(CACHE / "recog_312.npy", mmap_mode="r")
    backbone = load_backbone(dev)
    head = DinoHead().to(dev).eval()
    if args.head:
        head.load_state_dict(torch.load(ML / args.head if not Path(args.head).is_absolute() else args.head)["head"])
    cat = head.embed(clean_features().to(dev))
    labels = json.loads((DATA / "labels" / "labels.json").read_text(encoding="utf-8"))
    quads = None if args.hand else corner_quads(ML / args.corners, 2, dev)

    def emb(img):
        return head(features(backbone, img.to(dev)))

    def tmpl(c):
        return torch.from_numpy(np.ascontiguousarray(arr[c])).permute(2, 0, 1).float().div(255)

    res = []
    t0 = time.time()
    for name, lab in sorted(labels.items()):
        pr = lab.get("printing") or {}
        key = (pr.get("id"), str(pr.get("face", 0)))
        if lab.get("skip") or "corners" not in lab or key not in classes:
            continue
        truth_c = classes[key]
        with Image.open(DATA / "frames" / "cards" / name) as im:
            im = im.convert("RGB")
            W, H = im.size
            frame = torch.from_numpy(np.asarray(im).copy()).permute(2, 0, 1).float().div(255).to(dev)
        truth = torch.tensor(lab["corners"]) * torch.tensor([W, H])
        quad = truth if quads is None else quads[name].to(dev)
        with torch.no_grad():
            q = emb(straighten(frame, quad.to(dev))[None])
            sims = (q @ cat.T)[0]
            v, i = sims.topk(200)
        i, v = i.cpu().numpy(), v.cpu().numpy()
        cands, seen = [], set()
        for c, s in zip(i, v):
            if art[c] not in seen:
                seen.add(art[c])
                cands.append((int(c), float(s)))
            if len(cands) == args.k:
                break
        first = cands[0][0]
        gap1 = cands[0][1] - cands[1][1] if len(cands) > 1 else 1.0
        corners, match = align(frame, quad, torch.stack([tmpl(c) for c, _ in cands]))
        with torch.no_grad():
            flats = torch.stack([straighten(frame, corners[j]) for j in range(len(cands))])
            qq = emb(flats)
            again = (qq * cat[[c for c, _ in cands]]).sum(1)
        total = again + args.w * match
        order = torch.argsort(total, descending=True).cpu().numpy()
        pick = cands[order[0]][0]
        gap2 = float(total[order[0]] - total[order[1]]) if len(cands) > 1 else 1.0
        res.append(dict(name=name, d_card=oracle[first] == oracle[truth_c], p_card=oracle[pick] == oracle[truth_c],
                        gap1=gap1, gap2=gap2, match=float(match[order[0]]), miss_before=miss(quad, truth), miss_after=miss(corners[order[0]], truth),
                        in_top=any(oracle[c] == oracle[truth_c] for c, _ in cands)))
    dt = (time.time() - t0) / max(1, len(res))
    n = len(res)
    a = {k: np.array([r[k] for r in res]) for k in res[0] if k != "name"}
    print(f"{n} frames, {dt:.2f} s a frame; start: {'hand' if args.hand else 'corner finder'} corners; "
          f"head: {args.head or 'none'}; k={args.k}, w={args.w}")
    print(f"  fingerprint alone:        right card {a['d_card'].mean():.1%}")
    print(f"  right card among top {args.k}:  {a['in_top'].mean():.1%}")
    print(f"  snap + re-check:          right card {a['p_card'].mean():.1%}")
    print(f"  corner miss: {np.median(a['miss_before']):.3f} -> {np.median(a['miss_after']):.3f} (median, card widths)")
    for g in (0.02, 0.04, 0.06, 0.1):
        sure = a["gap2"] >= g
        print(f"  re-check gap {g:.2f}: adds {sure.mean():.0%} on its own, wrong {int(np.sum(sure & ~a['p_card']))}")
    for m in (0.5, 0.6, 0.7, 0.8):
        sure = a["match"] >= m
        print(f"  picture match {m:.1f}+: adds {sure.mean():.0%} on its own, wrong {int(np.sum(sure & ~a['p_card']))}")
    for r in res:
        if not r["p_card"]:
            print(f"  miss: {r['name']}  in top {args.k}: {r['in_top']}  gap {r['gap2']:.3f}")


if __name__ == "__main__":
    main()
