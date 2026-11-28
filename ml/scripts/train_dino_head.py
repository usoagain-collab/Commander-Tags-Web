"""Train the small head on frozen DINOv2 (scanner/dino_head.py) from cached features.

Needs:
- data/cache/dino_fakes.npy: fake photos' features (scripts/build_dino_fakes.py);
- runs/recog-v3/compare/dino_catalog.npz: clean catalog features (CLS, patch mean) of every printing;
- David's labeled frames: their features are worked out once (hand corners and the corner
  finder's corners) and kept in runs/<name>/real_feats.pt.

Loss: each fake photo must match its own printing's clean picture more than
thousands of others: 8,192 random printings plus look-alikes (the 32 nearest
other artworks by untrained DINOv2, which are the cards it actually confuses).
Other printings of the same artwork are never counted as wrong: telling those
apart is the corner reading's job (Stage 2), not the fingerprint's.

Every --eval-every steps: right card on David's frames against the whole
catalog, with hand corners and with corners-v2 corners (one frame at a time),
and on 2,000 held-out printings' fakes. Those 25 cards are a dev set from now
on (they steer choices); the locked test is the second shoot.

Output in runs/<name>/: log.csv, head.pt (best corners-v2 card score), last.pt.
A few minutes on the laptop.

Run:
  uv run python -I scripts/train_dino_head.py --name dino-head-v1
"""

import argparse
import csv
import json
import sys
import time
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))
sys.path.insert(0, str(ML / "scripts"))

import numpy as np  # noqa: E402
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402

from scanner.dino import features_of, load_backbone  # noqa: E402
from scanner.dino_head import DinoHead  # noqa: E402
from scanner.recog_data import CACHE, class_of, load_index, real_frames  # noqa: E402

CATALOG = ML / "runs" / "recog-v3" / "compare" / "dino_catalog.npz"


def clean_features() -> torch.Tensor:
    z = np.load(CATALOG)
    return torch.from_numpy(np.stack([z["cls"], z["patch"]], 1))   # (N, 2, 384) float16


def real_features(path: Path, index, dev) -> dict:
    """{'hand': (N,2,384), 'cv2': ..., 'cv2_1': ..., 'truth': (N,), 'names': [...]} for the labeled frames."""
    if path.exists():
        return torch.load(path)
    from eval_recognizer import corner_quads
    classes = class_of(index)
    model = load_backbone(dev)
    out = {}
    for key, quads in [("hand", None),
                       ("cv2", corner_quads(ML / "runs" / "corners-v2" / "best.pt", 2, dev)),
                       ("cv2_1", corner_quads(ML / "runs" / "corners-v2" / "best.pt", 1, dev))]:
        imgs, truth, names = real_frames(classes, quads)
        out[key] = features_of(model, imgs, dev)
        out["truth"], out["names"] = truth, names
    torch.save(out, path)
    return out


@torch.no_grad()
def look_alikes(cls: torch.Tensor, art: np.ndarray, k: int, dev, path: Path) -> torch.Tensor:
    """(N, k) the k nearest printings of other artworks, by untrained CLS features."""
    if path.exists():
        return torch.load(path)
    x = F.normalize(cls.to(dev).float(), dim=-1)
    art_t = torch.from_numpy(np.unique(art, return_inverse=True)[1]).to(dev)
    out = []
    for i in range(0, len(x), 1024):
        s = x[i:i + 1024] @ x.T
        s[art_t[i:i + 1024, None] == art_t[None]] = -2
        out.append(s.topk(k, dim=1).indices.cpu())
    nn_ = torch.cat(out)
    torch.save(nn_, path)
    return nn_


class Scorer:
    def __init__(self, index, real, clean, dev):
        self.dev = dev
        self.oracle = np.array([r["oracle_id"] for r in index])
        self.art = np.array([r["illustration_id"] or r["id"] + r["face"] for r in index])
        self.real, self.clean = real, clean.to(dev)

    @torch.no_grad()
    def __call__(self, head) -> dict:
        head.eval()
        cat = head.embed(self.clean)
        t = self.real["truth"].numpy()
        res = {}
        for key in ("hand", "cv2", "cv2_1"):
            q = head.embed(self.real[key].to(self.dev))
            v, i = (q @ cat.T).topk(60, dim=1)
            i, v = i.cpu().numpy(), v.cpu().numpy()
            first = i[:, 0]
            res[f"{key}_card"] = float(np.mean(self.oracle[first] == self.oracle[t]))
            res[f"{key}_art"] = float(np.mean(self.art[first] == self.art[t]))
            if key == "cv2":
                # gap to the best other artwork; how many it would add at 0.03 and how many wrong
                gap = np.array([v[r, 0] - next((v[r, c] for c in range(60) if self.art[i[r, c]] != self.art[first[r]]), -1)
                                for r in range(len(t))])
                ok = self.oracle[first] == self.oracle[t]
                for g in (0.02, 0.03):
                    res[f"cv2_sure{g}"] = float(np.mean(gap >= g))
                    res[f"cv2_wrong{g}"] = int(np.sum((gap >= g) & ~ok))
        head.train()
        return res


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="dino-head-v1")
    p.add_argument("--fakes", default="dino_fakes")
    p.add_argument("--steps", type=int, default=6000)
    p.add_argument("--batch", type=int, default=1024)
    p.add_argument("--bank", type=int, default=8192, help="random wrong printings per step")
    p.add_argument("--hard", type=int, default=4, help="look-alikes per photo per step")
    p.add_argument("--lr", type=float, default=5e-4)
    p.add_argument("--wd", type=float, default=0.05)
    p.add_argument("--temp", type=float, default=0.03)
    p.add_argument("--hidden", type=int, default=1024)
    p.add_argument("--dropout", type=float, default=0.1)
    p.add_argument("--eval-every", type=int, default=250)
    p.add_argument("--seed", type=int, default=0)
    args = p.parse_args()
    dev = "cuda"
    torch.manual_seed(args.seed)
    run = ML / "runs" / args.name
    run.mkdir(parents=True, exist_ok=True)
    (run / "args.json").write_text(json.dumps(vars(args), indent=1))

    index = load_index()
    n = len(index)
    clean = clean_features()
    art = np.array([r["illustration_id"] or r["id"] + r["face"] for r in index])
    art_id = torch.from_numpy(np.unique(art, return_inverse=True)[1]).to(dev)
    real = real_features(ML / "runs" / "dino-real-feats.pt", index, dev)
    nn_ = look_alikes(clean[:, 0], art, 32, dev, ML / "runs" / "dino-look-alikes.pt").to(dev)

    fakes = torch.from_numpy(np.load(CACHE / f"{args.fakes}.npy", mmap_mode="r")[:]).to(dev)   # (P*n, 2, 384) f16
    passes = len(fakes) // n
    # hold out 2,000 artworks' printings: their fakes check overfitting to fakes
    rng = np.random.default_rng(1)
    held_art = rng.choice(art_id.max().item() + 1, size=2000, replace=False)
    held = np.isin(art_id.cpu().numpy(), held_art)
    train_rows = torch.from_numpy(np.concatenate([np.flatnonzero(~held) + k * n for k in range(passes)])).to(dev)
    val_rows = torch.from_numpy(np.flatnonzero(held)).to(dev)     # pass 1's fakes of held-out printings
    print(f"{n:,} printings, {passes} fake passes, {len(train_rows):,} training fakes, "
          f"{len(val_rows):,} held out; {len(real['truth'])} real frames", flush=True)

    clean_d = clean.to(dev)
    head = DinoHead(args.hidden, args.dropout).to(dev)
    opt = torch.optim.AdamW(head.parameters(), lr=args.lr, weight_decay=args.wd)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.steps, pct_start=0.05)
    scorer = Scorer(index, real, clean, dev)

    @torch.no_grad()
    def val_score() -> float:
        head.eval()
        q = head.embed(fakes[val_rows])
        cat = head.embed(clean_d)
        best = (q @ cat.T).argmax(1)
        lab = val_rows % n
        head.train()
        return (art_id[best] == art_id[lab]).float().mean().item()

    fields = ["step", "loss", "acc", "val_art", "hand_card", "hand_art", "cv2_card", "cv2_art", "cv2_1_card",
              "cv2_1_art", "cv2_sure0.02", "cv2_wrong0.02", "cv2_sure0.03", "cv2_wrong0.03"]
    logf = open(run / "log.csv", "w", newline="", encoding="utf-8")
    log = csv.DictWriter(logf, fieldnames=fields)
    log.writeheader()

    def evaluate(step, loss, acc):
        nonlocal best
        res = {"step": step, "loss": loss, "acc": acc, "val_art": val_score(), **scorer(head)}
        log.writerow(res)
        logf.flush()
        print("  ".join(f"{k} {v:.3f}" if isinstance(v, float) else f"{k} {v}" for k, v in res.items()), flush=True)
        if res["cv2_card"] + 0.001 * res["hand_card"] > best:
            best = res["cv2_card"] + 0.001 * res["hand_card"]
            torch.save({"head": head.state_dict(), "args": vars(args), "step": step, **res}, run / "head.pt")

    best = -1.0
    evaluate(0, 0.0, 0.0)
    start = time.time()
    run_loss = run_acc = 0.0
    for step in range(1, args.steps + 1):
        rows = train_rows[torch.randint(0, len(train_rows), (args.batch,), device=dev)]
        lab = rows % n
        hard = nn_[lab][:, torch.randint(0, nn_.shape[1], (args.hard,), device=dev)].flatten()
        rand = torch.randint(0, n, (args.bank,), device=dev)
        cand = torch.cat([lab, hard, rand])
        q = head(fakes[rows])
        c = head(clean_d[cand])
        logits = q @ c.T / args.temp
        same = art_id[lab][:, None] == art_id[cand][None]
        same[:, :args.batch] &= ~torch.eye(args.batch, dtype=torch.bool, device=dev)
        logits = logits.masked_fill(same, float("-inf"))
        target = torch.arange(args.batch, device=dev)
        loss = F.cross_entropy(logits, target)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        sched.step()
        run_loss += loss.item()
        run_acc += (logits.argmax(1) == target).float().mean().item()
        if step % args.eval_every == 0 or step == args.steps:
            k = args.eval_every if step % args.eval_every == 0 else step % args.eval_every
            evaluate(step, run_loss / k, run_acc / k)
            run_loss = run_acc = 0.0
    torch.save({"head": head.state_dict(), "args": vars(args), "step": args.steps}, run / "last.pt")
    print(f"Done in {(time.time() - start) / 60:.1f} min. Best: {run / 'head.pt'}", flush=True)


if __name__ == "__main__":
    main()
