"""Make fake phone photos of every printing and cache their DINOv2 features (for train_dino_head.py).

The backbone is frozen, so a fake photo's features never change: making them
once and training the head on the cache lets each head experiment run in
minutes instead of a night. Each pass makes one fake of every printing in the
picture cache (115,080), with corner misses copied from the real corner
finder (data/corner_errors.npy, from scripts/corner_errors.py) on most fakes.

Writes data/cache/<name>.npy: (passes x printings, 2, 384) float16, row
p * printings + i = pass p's fake of printing i (CLS, patch mean). Safe to stop
and start again: it carries on from <name>.progress.

About 18 minutes a pass on the laptop (the backbone runs at 112 pictures a second).

Run (detached, so it survives the Claude app closing):
  runs\\detached.cmd runs\\dino-fakes scripts\\build_dino_fakes.py --passes 4
"""

import argparse
import sys
import time
from pathlib import Path

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))

import numpy as np  # noqa: E402
import torch  # noqa: E402

from scanner.dino import DIM, features, load_backbone  # noqa: E402
from scanner.recog_data import CACHE, DATA, to_float  # noqa: E402
from scanner.recog_synth import RecogSynth  # noqa: E402


def stay_awake() -> None:
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)


def main() -> None:
    stay_awake()
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="dino_fakes")
    p.add_argument("--cache", default="recog_312")
    p.add_argument("--passes", type=int, default=4)
    p.add_argument("--errors", default=str(DATA / "corner_errors.npy"))
    p.add_argument("--real-share", type=float, default=0.7, help="share of fakes that copy a real corner miss")
    p.add_argument("--batch", type=int, default=64)
    p.add_argument("--limit", type=int, default=0, help="only the first N printings (a quick test)")
    args = p.parse_args()
    dev = "cuda"
    arr = np.load(CACHE / f"{args.cache}.npy", mmap_mode="r")
    n = len(arr) if not args.limit else min(args.limit, len(arr))
    out_path = CACHE / f"{args.name}.npy"
    prog_path = CACHE / f"{args.name}.progress"
    shape = (args.passes * n, 2, DIM)
    if out_path.exists():
        out = np.load(out_path, mmap_mode="r+")
        if out.shape != shape:
            sys.exit(f"{out_path} has shape {out.shape}, not {shape}: use another --name")
    else:
        out = np.lib.format.open_memmap(out_path, mode="w+", dtype=np.float16, shape=shape)
    done = int(prog_path.read_text()) if prog_path.exists() else 0

    bgs = np.load(CACHE / "backgrounds.npy")
    errors = np.load(args.errors) if Path(args.errors).exists() else None
    print(f"{n:,} printings x {args.passes} passes, {len(bgs)} backgrounds, "
          f"{0 if errors is None else len(errors)} real corner misses; starting at {done:,}", flush=True)
    synth = RecogSynth(torch.from_numpy(bgs), device=dev, errors=errors, real_share=args.real_share)
    model = load_backbone(dev)

    start, last_save = time.time(), time.time()
    row = done
    while row < shape[0]:
        pas, i = divmod(row, n)
        j = min(i + args.batch, n)
        clean = to_float(torch.from_numpy(np.ascontiguousarray(arr[i:j])), dev)
        out[row:row + (j - i)] = features(model, synth(clean)).cpu().half().numpy()
        row += j - i
        if time.time() - last_save > 60 or row == shape[0]:
            out.flush()
            prog_path.write_text(str(row))
            last_save = time.time()
            rate = (row - done) / (time.time() - start)
            left = (shape[0] - row) / max(rate, 1e-6) / 60
            print(f"  pass {pas + 1}: {row:,} / {shape[0]:,}  {rate:.0f} a second, {left:.0f} min left", flush=True)
    print(f"Done: {out_path}", flush=True)


if __name__ == "__main__":
    main()
