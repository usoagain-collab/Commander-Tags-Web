"""Print each video's codec, size, frame rate and length (ml/data/videos/<folder>/*).

Run:  uv run python -I scripts/probe_videos.py
"""

from pathlib import Path

import av

VIDEOS = Path(__file__).resolve().parent.parent / "data" / "videos"


def main() -> None:
    for folder in sorted(p for p in VIDEOS.iterdir() if p.is_dir()):
        files = sorted(folder.glob("*.mp4")) + sorted(folder.glob("*.mov"))
        total = 0.0
        print(f"{folder.name}: {len(files)} videos")
        for f in files:
            with av.open(str(f)) as c:
                v = c.streams.video[0]
                secs = float(c.duration / av.time_base) if c.duration else 0.0
                total += secs
                rot = v.metadata.get("rotate") or ""
                print(f"  {f.name}  {v.codec_context.name} {v.codec_context.width}x{v.codec_context.height}"
                      f" {float(v.average_rate or 0):.0f} fps {secs:5.1f} s {rot}"
                      f" {f.stat().st_size / 2**20:5.0f} MB")
        print(f"  total {total / 60:.1f} min")


if __name__ == "__main__":
    main()
