"""Train the card recognizer (phase 3) on fake straightened photos of every printing.

Default loss: pairs (fake photo against the clean picture of the same printing,
the batch's other printings as the wrong answers; see scanner/recog_model.py).
--loss arcface is the first method, which collapsed on the full cache.

Every --eval-every steps it measures:
- synthetic: 1,000 fixed printings, one fake photo each, against those 1,000
  clean pictures (a quick "is it learning" number);
- real: David's labeled frames (data/labels/labels.json), flattened with the
  labeled corners, against a gallery of every printing of those cards plus
  --gallery other printings (30,000 by default; 0 = the whole catalog, which
  takes a few minutes per test). "card" = right card, "printing" = right printing.
  The full catalog test is eval_recognizer.py, after training.

Output in runs/<name>/: log.csv, last.pt, best.pt (best real printing score,
or synthetic while there are no real frames), fakes.jpg (what it trains on).

Run:
  uv run python -I scripts/train_recognizer.py --check          (2 minutes: speed, memory, fakes.jpg)
  uv run python -I scripts/build_recog_cache.py --limit 2000 --name recog_small
  uv run python -I scripts/train_recognizer.py --name recog-small --cache recog_small --epochs 30 --eval-every 200
                                                                 (a 10-minute proof before the long run)
  uv run python -I scripts/train_recognizer.py --name recog-v1  (a night or two)
  uv run python -I scripts/train_recognizer.py --name recog-v1 --resume
"""

import argparse
import csv
import math
import random
import sys
import time
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from PIL import Image  # noqa: E402

from scanner.recog_data import (CACHE, BatchSet, class_of, embed, embed_cache, epoch_batches,  # noqa: E402
                                load_index, real_frames, to_float)
from scanner.recog_model import ArcFace, RecogNet, pair_loss  # noqa: E402
from scanner.recog_synth import RecogSynth  # noqa: E402


def stay_awake() -> None:
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)


def save_grid(imgs: torch.Tensor, path: Path, cols: int = 8) -> None:
    imgs = (imgs.clamp(0, 1) * 255).byte().permute(0, 2, 3, 1).cpu().numpy()
    n, h, w, _ = imgs.shape
    rows = (n + cols - 1) // cols
    sheet = np.zeros((rows * h, cols * w, 3), np.uint8)
    for i, im in enumerate(imgs):
        sheet[(i // cols) * h:(i // cols + 1) * h, (i % cols) * w:(i % cols + 1) * w] = im
    Image.fromarray(sheet).save(path, quality=88)


class Evaluator:
    def __init__(self, index, arr, backgrounds, device, others: int = 30000):
        self.arr, self.device = arr, device
        rng = np.random.default_rng(123)
        n = len(index)
        self.syn_idx = np.sort(rng.choice(n, size=min(1000, n), replace=False))
        clean = torch.from_numpy(np.ascontiguousarray(arr[self.syn_idx]))
        synth = RecogSynth(backgrounds, device=device, seed=321)
        self.syn_fakes = torch.cat([synth(to_float(clean[i:i + 64], device)).cpu()
                                    for i in range(0, len(clean), 64)])
        self.real = real_frames(class_of(index))
        self.gallery = None
        if self.real is not None:
            cls = self.real[1].numpy()
            oracle = {index[c]["oracle_id"] for c in cls}
            self.oracle_of = np.array([r["oracle_id"] for r in index])
            same = np.array([i for i, r in enumerate(index) if r["oracle_id"] in oracle])
            pick = np.arange(n) if not others or others >= n else rng.choice(n, size=others, replace=False)
            self.gallery = np.unique(np.concatenate([same, pick]))

    @torch.no_grad()
    def __call__(self, model) -> dict:
        model.eval()
        res = {}
        g = embed_cache(model, self.arr, self.syn_idx, self.device)
        q = embed(model, self.syn_fakes, self.device)
        res["syn_top1"] = ((q @ g.T).argmax(1) == torch.arange(len(q))).float().mean().item()
        if self.real is not None:
            imgs, cls, _ = self.real
            g = embed_cache(model, self.arr, self.gallery, self.device)
            q = embed(model, imgs, self.device)
            sim = q @ g.T
            best = torch.from_numpy(self.gallery)[sim.argmax(1)]
            res["real_n"] = len(cls)
            res["real_printing"] = (best == cls).float().mean().item()
            res["real_card"] = float(np.mean(self.oracle_of[best.numpy()] == self.oracle_of[cls.numpy()]))
            top2 = sim.topk(2, dim=1).values
            res["real_margin"] = (top2[:, 0] - top2[:, 1]).median().item()
        model.train()
        return res


def main() -> None:
    stay_awake()
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="recog-v1")
    p.add_argument("--cache", default="recog_312")
    p.add_argument("--epochs", type=float, default=20)
    p.add_argument("--loss", choices=["pairs", "arcface"], default="pairs")
    p.add_argument("--batch", type=int, default=16, help="printings per batch (pairs: 2 pictures each)")
    p.add_argument("--group", type=int, default=2, help="printings of the same card that sit together in a batch")
    p.add_argument("--lr", type=float, default=1e-4, help="backbone learning rate (the head gets 10 times this)")
    p.add_argument("--temp", type=float, default=0.05, help="pairs: how sharply the loss separates matches")
    p.add_argument("--margin", type=float, default=0.3, help="arcface only")
    p.add_argument("--corner-err", type=float, default=0.045, help="largest corner miss, share of card width")
    p.add_argument("--workers", type=int, default=3)
    p.add_argument("--eval-every", type=int, default=3000)
    p.add_argument("--gallery", type=int, default=30000, help="other printings in the real-frame test; 0 = all")
    p.add_argument("--resume", action="store_true")
    p.add_argument("--check", action="store_true", help="60 steps: speed, memory, fakes.jpg; nothing saved")
    p.add_argument("--cpu", action="store_true")
    args = p.parse_args()
    dev = "cpu" if args.cpu or not torch.cuda.is_available() else "cuda"
    run = ML / "runs" / (args.name if not args.check else "recog-check")
    run.mkdir(parents=True, exist_ok=True)
    if dev == "cuda":
        torch.backends.cudnn.benchmark = True

    print("Loading the picture cache...", flush=True)
    index = load_index(args.cache)
    path = CACHE / f"{args.cache}.npy"
    arr = np.load(path, mmap_mode="r")
    n_cls = len(index)
    bg_path = CACHE / "backgrounds.npy"
    backgrounds = torch.from_numpy(np.load(bg_path)) if bg_path.exists() else None
    synth = RecogSynth(backgrounds, device=dev, corner_err=args.corner_err)
    print(f"{n_cls:,} printings (classes), "
          f"{0 if backgrounds is None else len(backgrounds)} backgrounds, device {dev}", flush=True)

    model = RecogNet(pretrained=True).to(dev)
    arc = ArcFace(n_cls, margin=args.margin).to(dev) if args.loss == "arcface" else None
    # a pretrained backbone is wrecked by a big learning rate (the first ArcFace run used 1e-3 throughout)
    groups = [{"params": model.features.parameters(), "weight_decay": 1e-4, "scale": 1.0},
              {"params": model.head.parameters(), "weight_decay": 1e-4, "scale": 10.0}]
    if arc is not None:
        groups.append({"params": arc.parameters(), "weight_decay": 0.0, "scale": 10.0})
    opt = torch.optim.AdamW(groups, lr=args.lr)
    params = [q for g in groups for q in g["params"]]
    steps_per_epoch = max(1, n_cls // args.batch)
    total = int(args.epochs * steps_per_epoch) if not args.check else 60
    warmup = min(2000, total // 10)

    def lr_at(step):
        if step < warmup:
            return args.lr * (step + 1) / warmup
        t = (step - warmup) / max(1, total - warmup)
        return 1e-6 + (args.lr - 1e-6) * 0.5 * (1 + math.cos(math.pi * t))

    step, best = 0, -1.0
    if args.resume and (run / "last.pt").exists():
        ck = torch.load(run / "last.pt", map_location=dev)
        model.load_state_dict(ck["model"])
        if arc is not None:
            arc.load_state_dict(ck["arc"])
        opt.load_state_dict(ck["opt"])
        step, best = ck["step"], ck["best"]
        print(f"Resumed at step {step:,}", flush=True)

    evaluator = None if args.check else Evaluator(index, arr, backgrounds, dev, args.gallery)
    if evaluator is not None and evaluator.real is not None:
        print(f"Real test: {len(evaluator.real[1])} labeled frames, gallery of {len(evaluator.gallery):,}", flush=True)

    log_path = run / "log.csv"
    fields = ["step", "epoch", "time", "lr", "loss", "acc", "syn_top1", "real_n", "real_card", "real_printing",
              "real_margin"]
    logf = log = None
    if not args.check:
        new = not log_path.exists() or not args.resume
        logf = open(log_path, "w" if new else "a", newline="", encoding="utf-8")
        log = csv.DictWriter(logf, fieldnames=fields)
        if new:
            log.writeheader()

    model.train()
    start = time.time()
    run_loss = run_acc = 0.0
    n = 0
    epoch = step // steps_per_epoch
    preview_saved = False
    while step < total:
        batches = epoch_batches(index, args.batch, random.Random(epoch), group=args.group)
        skip = step - epoch * steps_per_epoch
        loader = torch.utils.data.DataLoader(BatchSet(path, batches[max(0, skip):]), batch_size=None,
                                             shuffle=False, num_workers=args.workers,
                                             pin_memory=dev == "cuda", persistent_workers=False,
                                             prefetch_factor=4 if args.workers else None)
        for imgs, labels in loader:
            if step >= total:
                break
            for gr in opt.param_groups:
                gr["lr"] = lr_at(step) * gr["scale"]
            # gentler fakes (and, for arcface, no margin) at first
            ramp = min(1.0, step / max(1, steps_per_epoch))
            synth.strength = 0.4 + 0.6 * ramp
            clean = to_float(imgs, dev)
            x = synth(clean)
            if not preview_saved:
                save_grid(x[:32], run / "fakes.jpg")
                preview_saved = True
            if arc is None:
                emb = model(torch.cat([x, clean]))   # one pass, so batch norm sees photos and clean pictures together
                loss, acc = pair_loss(emb[:len(x)], emb[len(x):], args.temp)
            else:
                loss, acc = arc(model(x), labels.to(dev), margin=args.margin * ramp)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 5.0)
            opt.step()
            step += 1
            run_loss += loss.item()
            run_acc += acc.item()
            n += 1
            if step % 100 == 0 or args.check and step % 10 == 0:
                el = time.time() - start
                rate = n * args.batch * (2 if arc is None else 1) / max(1e-6, el) if args.check else None
                extra = f"  {rate:.0f} pictures/s" if rate else ""
                if dev == "cuda" and args.check:
                    extra += f"  GPU memory {torch.cuda.max_memory_allocated() / 2**30:.2f} GB"
                print(f"step {step:7,}  epoch {step / steps_per_epoch:5.2f}  loss {run_loss / n:.3f}  "
                      f"acc {run_acc / n:.3f}  lr {lr_at(step):.2e}  {el / 60:6.1f} min{extra}", flush=True)
            if not args.check and (step % args.eval_every == 0 or step == total):
                res = evaluator(model)
                row = {"step": step, "epoch": round(step / steps_per_epoch, 3), "time": round(time.time() - start),
                       "lr": lr_at(step), "loss": run_loss / n, "acc": run_acc / n, **res}
                log.writerow(row)
                logf.flush()
                run_loss = run_acc = 0.0
                n = 0
                score = res.get("real_printing", res["syn_top1"]) + 0.001 * res.get("real_card", 0)
                ck = {"model": model.state_dict(), "opt": opt.state_dict(), "loss": args.loss,
                      "step": step, "best": max(best, score), "cache": args.cache}
                if arc is not None:
                    ck["arc"] = arc.state_dict()
                if score > best:
                    best = score
                    torch.save({"model": model.state_dict(), "step": step, "cache": args.cache}, run / "best.pt")
                torch.save(ck, run / "last.pt")
                text = "  ".join(f"{k} {v:.4f}" if isinstance(v, float) else f"{k} {v}" for k, v in res.items())
                print(f"== eval step {step:,}: {text}", flush=True)
        epoch += 1
    if args.check:
        print(f"Check done. Fakes in {run / 'fakes.jpg'}. If memory is near 6 GB, use a smaller --batch.")
    else:
        print(f"Done. Files in {run}")


if __name__ == "__main__":
    main()
