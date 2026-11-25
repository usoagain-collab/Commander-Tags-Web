"""Data for the card recognizer: the picture cache, hard batches, and David's real frames.

Hard batches: printings of the same card (same oracle id) are put in the same
batch, up to 4 at a time, so the model has to learn the small differences
between them (set symbol, frame, border, collector line) rather than only
"which artwork is this". Every picture still comes up once per pass.
"""

import csv
import json
import random
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from scanner.straighten import straighten

ML = Path(__file__).resolve().parent.parent
DATA = ML / "data"
CACHE = DATA / "cache"


def load_index(name: str = "recog_312") -> list[dict]:
    with open(CACHE / f"{name}.csv", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def class_of(index: list[dict]) -> dict[tuple[str, str], int]:
    """(scryfall id, face) -> class number."""
    return {(r["id"], r["face"]): int(r["cls"]) for r in index}


def epoch_batches(index: list[dict], batch: int, rng: random.Random, group: int = 4) -> list[list[int]]:
    """One pass over every picture, in batches where same-card printings sit together."""
    by_card: dict[str, list[int]] = {}
    for r in index:
        by_card.setdefault(r["oracle_id"] or r["id"], []).append(int(r["cls"]))
    chunks = []
    for members in by_card.values():
        rng.shuffle(members)
        chunks += [members[i:i + group] for i in range(0, len(members), group)]
    rng.shuffle(chunks)
    out, cur = [], []
    for c in chunks:
        if len(cur) + len(c) > batch:
            out.append(cur)
            cur = []
        cur += c
    if len(cur) >= batch // 2:
        out.append(cur)
    return out


class BatchSet(torch.utils.data.Dataset):
    """Item i = batch i: (uint8 pictures (B, H, W, 3), class numbers (B,)). Opens the cache lazily
    so each loader process maps the file itself (on Windows, workers are fresh processes)."""

    def __init__(self, path: Path, batches: list[list[int]]):
        self.path, self.batches, self.arr = path, batches, None

    def __len__(self):
        return len(self.batches)

    def __getitem__(self, i):
        if self.arr is None:
            self.arr = np.load(self.path, mmap_mode="r")
        idx = np.asarray(self.batches[i])
        order = np.argsort(idx)          # read the file front to back
        imgs = np.empty((len(idx),) + self.arr.shape[1:], np.uint8)
        imgs[order] = self.arr[idx[order]]
        return torch.from_numpy(imgs), torch.from_numpy(idx)


def to_float(imgs: torch.Tensor, device) -> torch.Tensor:
    """(B, H, W, 3) uint8 -> (B, 3, H, W) float 0..1 on device."""
    return imgs.to(device, non_blocking=True).permute(0, 3, 1, 2).float().div_(255)


@torch.no_grad()
def embed(model, imgs: torch.Tensor, device, bs: int = 128) -> torch.Tensor:
    """(N, 3, H, W) float 0..1 (CPU) -> (N, 128) fingerprints (CPU)."""
    out = []
    for i in range(0, len(imgs), bs):
        out.append(model(imgs[i:i + bs].to(device)).float().cpu())
    return torch.cat(out) if out else torch.zeros(0, 128)


@torch.no_grad()
def embed_cache(model, arr: np.ndarray, idx: np.ndarray, device, bs: int = 128) -> torch.Tensor:
    """Fingerprints of the clean cached pictures at rows idx."""
    out = []
    for i in range(0, len(idx), bs):
        part = torch.from_numpy(np.ascontiguousarray(arr[np.sort(idx[i:i + bs])]))
        order = np.argsort(np.argsort(idx[i:i + bs]))
        out.append(model(to_float(part, device)).float().cpu()[order])
    return torch.cat(out) if out else torch.zeros(0, 128)


def real_frames(classes: dict[tuple[str, str], int], quads: dict[str, torch.Tensor] | None = None):
    """David's labeled frames whose printing is in the cache, flattened with the labeled corners
    (or with quads[name] when given, e.g. the corner finder's answer).
    Returns (pictures (N, 3, 312, 224), class numbers (N,), frame names)."""
    path = DATA / "labels" / "labels.json"
    if not path.exists():
        return None
    labels = json.loads(path.read_text(encoding="utf-8"))
    imgs, cls, names = [], [], []
    for name, lab in sorted(labels.items()):
        pr = lab.get("printing") or {}
        key = (pr.get("id"), str(pr.get("face", 0)))
        frame = DATA / "frames" / "cards" / name
        if lab.get("skip") or "corners" not in lab or key not in classes or not frame.exists():
            continue
        with Image.open(frame) as im:
            im = im.convert("RGB")
            W, H = im.size
            t = torch.from_numpy(np.asarray(im).copy()).permute(2, 0, 1).float() / 255
        q = quads[name] if quads and name in quads else torch.tensor(lab["corners"]) * torch.tensor([W, H])
        imgs.append(straighten(t, q.float()))
        cls.append(classes[key])
        names.append(name)
    if not imgs:
        return None
    return torch.stack(imgs), torch.tensor(cls), names
