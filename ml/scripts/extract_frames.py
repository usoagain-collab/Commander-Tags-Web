"""Pull still frames out of David's videos.

- Card videos (data/videos/cards): the video is cut into 4 equal parts (skipping
  the first and last third of a second) and the sharpest frame of each part is
  saved, upright, at full size to data/frames/cards/<video>_<ms>.jpg. These get
  labeled (corners + printing) with scripts/label_server.py.
- Surface videos (data/videos/surfaces): one frame every half second, saved at
  640 px on the long side to data/backgrounds/<video>_<ms>.jpg. These become
  the backgrounds of the fake training photos.

Frames already saved are kept, so it's safe to run again after adding videos.

Run:  uv run python -I scripts/extract_frames.py [--per-video 4]
"""

import argparse
from pathlib import Path

import av
import numpy as np
from PIL import Image

DATA = Path(__file__).resolve().parent.parent / "data"
VIDEOS = DATA / "videos"
CARD_FRAMES = DATA / "frames" / "cards"
BACKGROUNDS = DATA / "backgrounds"
VIDEO_TYPES = ("*.mp4", "*.mov", "*.MP4", "*.MOV")


def videos(folder: Path) -> list[Path]:
    found: set[Path] = set()
    for pattern in VIDEO_TYPES:
        found.update(folder.glob(pattern))
    return sorted(found)


def upright(frame: av.VideoFrame) -> Image.Image:
    """Phones store portrait video sideways plus a rotation note; apply it."""
    im = frame.to_image()
    rot = getattr(frame, "rotation", 0) or 0
    return im.rotate(rot, expand=True) if rot else im


def sharpness(im: Image.Image) -> float:
    """Variance of a Laplacian on a small gray copy: higher = sharper."""
    g = np.asarray(im.convert("L").resize((im.width // 4, im.height // 4)), dtype=np.float32)
    lap = 4 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(lap.var())


def card_frames(path: Path, per_video: int) -> int:
    stem = path.stem
    if list(CARD_FRAMES.glob(f"{stem}_*.jpg")):
        return 0
    with av.open(str(path)) as c:
        s = c.streams.video[0]
        s.thread_type = "AUTO"
        dur = float(c.duration / av.time_base)
        lo, hi = 0.33, max(0.34, dur - 0.33)
        edges = [lo + (hi - lo) * i / per_video for i in range(per_video + 1)]
        best: list[tuple[float, float, av.VideoFrame | None]] = [(-1.0, 0.0, None)] * per_video
        for n, frame in enumerate(c.decode(s)):
            if n % 2:  # every other frame is plenty at 30 fps
                continue
            t = float(frame.pts * s.time_base)
            if not lo <= t < hi:
                continue
            part = min(per_video - 1, next(i for i in range(per_video) if t < edges[i + 1]))
            score = sharpness(frame.to_image())
            if score > best[part][0]:
                best[part] = (score, t, frame.reformat(format="rgb24"))
    saved = 0
    for score, t, frame in best:
        if frame is None:
            continue
        upright(frame).save(CARD_FRAMES / f"{stem}_{round(t * 1000):05d}.jpg", quality=92)
        saved += 1
    return saved


def background_frames(path: Path, every: float = 0.5) -> int:
    stem = path.stem
    if list(BACKGROUNDS.glob(f"{stem}_*.jpg")):
        return 0
    saved = 0
    next_t = 0.0
    with av.open(str(path)) as c:
        s = c.streams.video[0]
        s.thread_type = "AUTO"
        for frame in c.decode(s):
            t = float(frame.pts * s.time_base)
            if t < next_t:
                continue
            next_t = t + every
            im = upright(frame)
            im.thumbnail((640, 640), Image.LANCZOS)
            im.save(BACKGROUNDS / f"{stem}_{round(t * 1000):05d}.jpg", quality=90)
            saved += 1
    return saved


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-video", type=int, default=4)
    args = parser.parse_args()
    CARD_FRAMES.mkdir(parents=True, exist_ok=True)
    BACKGROUNDS.mkdir(parents=True, exist_ok=True)

    cards = videos(VIDEOS / "cards")
    total = 0
    for i, v in enumerate(cards, 1):
        n = card_frames(v, args.per_video)
        total += n
        print(f"\rcard videos {i}/{len(cards)}: {total} new frames", end="", flush=True)
    print()
    surfaces = videos(VIDEOS / "surfaces")
    total = 0
    for i, v in enumerate(surfaces, 1):
        total += background_frames(v)
        print(f"\rsurface videos {i}/{len(surfaces)}: {total} new backgrounds", end="", flush=True)
    print()
    print(f"Card frames: {len(list(CARD_FRAMES.glob('*.jpg')))} in {CARD_FRAMES}")
    print(f"Backgrounds: {len(list(BACKGROUNDS.glob('*.jpg')))} in {BACKGROUNDS}")


if __name__ == "__main__":
    main()
