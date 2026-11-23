"""Train the corner finder on fake photos made on the fly, and score it on real ones.

Every --eval-every steps it measures:
- synthetic: a fixed set of 1,024 fake photos;
- real corners: every labeled frame in data/labels/labels.json (re-read each
  time, so labels added during training count). The go / no-go numbers from
  docs/scanner-model-spec.md: mean corner error under 2% of the card's width,
  95% of frames under 4%;
- real "no card": frames of the last 2 surface videos, which are kept out of
  training so they're surfaces the model has never seen.

Output in runs/<name>/: log.csv, last.pt, best.pt (lowest real corner error
once there are 20+ labeled frames, else lowest synthetic error).

Run:  uv run python -I scripts/train_corners.py --name corners-v1 [--steps 40000] [--resume]
"""

import argparse
import csv
import json
import math
import sys
import time
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402

from scanner.corner_model import CornerNet, corner_error, corner_loss  # noqa: E402
from scanner.synth import OUT_H, OUT_W, Synth  # noqa: E402

DATA = ML / "data"
CACHE = DATA / "cache"
HOLDOUT_SURFACES = 2


def background_split():
    names = sorted((DATA / "backgrounds").glob("*.jpg"))
    videos = sorted({p.name.rsplit("_", 1)[0] for p in names})
    held = set(videos[-HOLDOUT_SURFACES:])
    train_idx = [i for i, p in enumerate(names) if p.name.rsplit("_", 1)[0] not in held]
    test_paths = [p for p in names if p.name.rsplit("_", 1)[0] in held]
    return train_idx, test_paths


def load_frame(path: Path) -> tuple[torch.Tensor, tuple[int, int]]:
    """Photo -> (3, 384, 256) tensor 0..1 (stretched slightly, like the phone will do)."""
    with Image.open(path) as im:
        im = im.convert("RGB")
        size = im.size
        if im.width > im.height:
            im = im.rotate(90, expand=True)
        im = im.resize((OUT_W, OUT_H), Image.BILINEAR)
    return torch.from_numpy(np.asarray(im).copy()).permute(2, 0, 1).float() / 255, size


def real_set():
    path = DATA / "labels" / "labels.json"
    if not path.exists():
        return None
    labels = json.loads(path.read_text(encoding="utf-8"))
    imgs, corners, hidden = [], [], []
    for name, lab in sorted(labels.items()):
        if lab.get("skip") or "corners" not in lab:
            continue
        frame = DATA / "frames" / "cards" / name
        if not frame.exists():
            continue
        img, (w, h) = load_frame(frame)
        if w > h:
            continue  # landscape frames would need their corners rotated too; none so far
        imgs.append(img)
        corners.append(torch.tensor(lab["corners"]) * torch.tensor([OUT_W, OUT_H]))
        hidden.append(torch.tensor(lab["hidden"], dtype=torch.float32))
    if not imgs:
        return None
    return torch.stack(imgs), torch.stack(corners), torch.stack(hidden)


@torch.no_grad()
def predict(model, imgs: torch.Tensor, bs: int = 64):
    outs = []
    for i in range(0, len(imgs), bs):
        o = model(imgs[i:i + bs].cuda())
        outs.append({k: v.float().cpu() for k, v in o.items() if k != "heat"})
    return {k: torch.cat([o[k] for o in outs]) for k in outs[0]}


@torch.no_grad()
def evaluate(model, synth_val, empty_imgs):
    model.eval()
    res = {}
    img, present, corners, hidden = synth_val
    o = predict(model, img)
    m = present > 0.5
    px = o["corners"] * torch.tensor([OUT_W, OUT_H])
    err = corner_error(px[m], corners[m]).mean(1)
    res["syn_err"] = err.mean().item()
    res["syn_within4"] = (err < 0.04).float().mean().item()
    res["syn_present_acc"] = ((o["present"] > 0) == m).float().mean().item()

    real = real_set()
    if real is not None:
        rimg, rcorners, rhidden = real
        o = predict(model, rimg)
        px = o["corners"] * torch.tensor([OUT_W, OUT_H])
        err = corner_error(px, rcorners).mean(1)
        res["real_n"] = len(rimg)
        res["real_err"] = err.mean().item()
        res["real_median"] = err.median().item()
        res["real_within4"] = (err < 0.04).float().mean().item()
        res["real_found"] = (o["present"] > 0).float().mean().item()
    if empty_imgs is not None:
        o = predict(model, empty_imgs)
        res["empty_correct"] = (o["present"] <= 0).float().mean().item()
    model.train()
    return res


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="corners-v1")
    p.add_argument("--steps", type=int, default=40000)
    p.add_argument("--batch", type=int, default=64)
    p.add_argument("--lr", type=float, default=2e-3)
    p.add_argument("--eval-every", type=int, default=2000)
    p.add_argument("--resume", action="store_true")
    args = p.parse_args()

    run = ML / "runs" / args.name
    run.mkdir(parents=True, exist_ok=True)
    torch.backends.cudnn.benchmark = True

    print("Loading caches...", flush=True)
    cards = torch.from_numpy(np.load(CACHE / "cards_224.npy")).pin_memory()
    train_idx, empty_paths = background_split()
    bgs = torch.from_numpy(np.load(CACHE / "backgrounds.npy")[train_idx])
    synth = Synth(cards, bgs)
    val = Synth(cards, bgs, seed=123)
    parts = [val.batch(128) for _ in range(8)]
    synth_val = (torch.cat([b.image for b in parts]).cpu(), torch.cat([b.present for b in parts]).cpu(),
                 torch.cat([b.corners for b in parts]).cpu(), torch.cat([b.hidden for b in parts]).cpu())
    del val, parts
    empty = torch.stack([load_frame(pth)[0] for pth in empty_paths]) if empty_paths else None
    print(f"{cards.shape[0]:,} cards, {len(train_idx)} training backgrounds, "
          f"{len(empty_paths)} held-out empty frames", flush=True)

    model = CornerNet().cuda()
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    warmup = 1000

    def lr_at(step):
        if step < warmup:
            return args.lr * step / warmup
        t = (step - warmup) / max(1, args.steps - warmup)
        return 1e-5 + (args.lr - 1e-5) * 0.5 * (1 + math.cos(math.pi * t))

    step, best = 0, float("inf")
    if args.resume and (run / "last.pt").exists():
        ck = torch.load(run / "last.pt", map_location="cuda")
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["opt"])
        step, best = ck["step"], ck["best"]
        print(f"Resumed at step {step}", flush=True)

    log_path = run / "log.csv"
    fields = ["step", "time", "lr", "loss", "xy", "heat", "present", "hidden", "syn_err", "syn_within4",
              "syn_present_acc", "real_n", "real_err", "real_median", "real_within4", "real_found", "empty_correct"]
    new_log = not log_path.exists() or not args.resume
    logf = open(log_path, "w" if new_log else "a", newline="", encoding="utf-8")
    log = csv.DictWriter(logf, fieldnames=fields)
    if new_log:
        log.writeheader()

    model.train()
    start = time.time()
    run_loss, parts_sum, n = 0.0, {}, 0
    while step < args.steps:
        for g in opt.param_groups:
            g["lr"] = lr_at(step)
        b = synth.batch(args.batch)
        out = model(b.image)
        loss, parts_ = corner_loss(out, b.present, b.corners, b.hidden, OUT_W, OUT_H)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
        opt.step()
        step += 1
        run_loss += loss.item()
        for k, v in parts_.items():
            parts_sum[k] = parts_sum.get(k, 0) + v
        n += 1
        if step % 200 == 0:
            el = time.time() - start
            print(f"step {step:6d}  loss {run_loss / n:.4f}  xy {parts_sum['xy'] / n:.4f}  "
                  f"lr {lr_at(step):.2e}  {el / 60:5.1f} min", flush=True)
        if step % args.eval_every == 0 or step == args.steps:
            res = evaluate(model, synth_val, empty)
            row = {"step": step, "time": round(time.time() - start), "lr": lr_at(step), "loss": run_loss / n,
                   **{k: v / n for k, v in parts_sum.items()}, **res}
            log.writerow(row)
            logf.flush()
            run_loss, parts_sum, n = 0.0, {}, 0
            score = res["real_err"] if res.get("real_n", 0) >= 20 else res["syn_err"]
            ck = {"model": model.state_dict(), "opt": opt.state_dict(), "step": step, "best": min(best, score)}
            if score < best:
                best = score
                torch.save(ck, run / "best.pt")
            torch.save(ck, run / "last.pt")
            text = "  ".join(f"{k} {v:.4f}" if isinstance(v, float) else f"{k} {v}" for k, v in res.items())
            print(f"== eval step {step}: {text}", flush=True)
    print(f"Done. Best score {best:.4f}. Files in {run}", flush=True)


if __name__ == "__main__":
    main()
