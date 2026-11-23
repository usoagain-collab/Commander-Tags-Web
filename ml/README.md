# Scanner models (ml/)

Python code that trains the card scanner's two small models on David's laptop: a **corner finder** (puts a dot on each of the card's 4 corners) and a **card recognizer** (turns a straightened card into 128 numbers and finds the closest printing). The plan, phases and go / no-go tests are in [`docs/scanner-model-spec.md`](../docs/scanner-model-spec.md). The website never runs this Python; it will load the finished models (small ONNX files) in the browser.

Nothing here is AGPL: PyTorch and torchvision (BSD), kornia (Apache-2.0), onnx and onnxruntime (MIT/Apache). No Ultralytics YOLO, no CollectorVision code or weights.

## What's in git and what isn't

- In git: this README, `pyproject.toml`, `uv.lock`, `scripts/`.
- **Not in git** (see `.gitignore`): `ml/data/` (Scryfall's card list, about 3.7 GB of card pictures, David's videos, fake photos) and `ml/runs/` (training output). Never commit those: they're big, and the pictures are Scryfall's.

## Set up (once)

The laptop already has Python 3.14, but PyTorch is safest on 3.12, so this folder uses **uv**, a tool that installs its own Python 3.12 and keeps this project's packages separate from everything else.

1. Install uv (PowerShell):
   ```powershell
   py -m pip install --user uv
   ```
   That puts `uv.exe` in `C:\Users\usoag\AppData\Roaming\Python\Python314\Scripts`, which isn't on the PATH. Either add that folder to the PATH, or write `py -m uv` wherever this README says `uv`.
2. In this folder, install Python 3.12 and the packages (PyTorch with CUDA comes from PyTorch's own download site, set in `pyproject.toml`; about 3 GB the first time):
   ```powershell
   cd C:\Users\usoag\Documents\Commander-Tags-Web\ml
   uv sync
   ```

## Scripts

Run each from the `ml` folder. `-I` tells Python not to load code from the current folder, a safety habit when a folder holds downloaded files.

| Command | What it does | Time |
| --- | --- | --- |
| `uv run python -I scripts/gpu_check.py` | Trains a throwaway model on the graphics card for a minute and prints images per second | 1 min |
| `uv run python -I scripts/build_manifest.py` | Downloads Scryfall's `default_cards` list (every printing, about 81 MB) and writes `data/manifest.csv`: paper printings with pictures, one row per picture (double-faced cards have two). `--refresh` gets a newer list | 2 min |
| `uv run python -I scripts/download_images.py` | Downloads every picture in the manifest, shrunk to 320 px tall, into `data/images/`. At most 10 a second. **Safe to stop and start again**: it skips pictures it already has and retries the ones that failed (listed in `data/images_failed.csv`). Progress in `data/download_images.log` | about 3.2 hours |

### Phase 1: real frames and labels

Put the phone videos in `data/videos/surfaces` (no cards) and `data/videos/cards` (one card per video), then:

| Command | What it does | Time |
| --- | --- | --- |
| `uv run python -I scripts/probe_videos.py` | Lists each video's format, size and length | seconds |
| `uv run python -I scripts/extract_frames.py` | Saves the 4 sharpest frames of each card video (one per quarter) to `data/frames/cards/`, and a frame every half second of each surface video to `data/backgrounds/` (640 px). Skips videos it has already done | about 15 s per video |
| `uv run python -I scripts/label_server.py` | Opens the labeling page at http://localhost:8765 (this laptop only). Tap the 4 corners, pick the printing, Save. Labels save to `data/labels/labels.json` at every Save, with a backup of the previous version. Ctrl+C in its window stops it | |

**On a phone:** start it with `--phone`. It prints an address like `http://192.168.1.142:8765/?k=abc123` to open on a phone on the same Wi-Fi (allow Python on Private networks if Windows asks). The `k=` code changes each start; requests without it are refused. On a phone the frame list sits behind **Frames**, and a zoom bubble shows the spot under your finger while you drag a dot.

Labeling tips (also on the page): start at the card's own top-left corner (left of the name, even when the card is upside down) and go clockwise; the gold edge is the card's top. A corner under a finger still gets a dot where the corner really is, then **H** marks it covered. On sleeved cards mark the card, not the sleeve. The printing, foil and sleeve carry over to the other frames of the same video. **No usable card** skips a frame (too blurry, card cut off).

### Phase 2: corner finder

| Command | What it does | Time |
| --- | --- | --- |
| `uv run python -I scripts/build_cache.py` | Packs 30,000 random card pictures (224 px tall) and every background into `data/cache/` so training never waits on decoding JPEGs (3.4 GB) | 2 min |
| `uv run python -I scripts/preview_synth.py` | Saves 24 fake training photos with their corner targets drawn on to `data/synth_preview.jpg` (gold = card's top-left, red ring = covered) and times the generator | 30 s |
| `uv run python -I scripts/train_corners.py --name corners-v1` | Trains the corner finder on fake photos made on the fly. Every 2,000 steps it scores itself on 1,024 fixed fake photos, on every labeled real frame (labels added during training count), and on 2 surface videos kept out of training ("no card" test). `--resume` carries on after a stop. Output in `runs/<name>/` (`log.csv`, `best.pt`, `last.pt`) | about 3.5 hours for 40,000 steps |

Code shared by the scripts lives in `scanner/`: `synth.py` (fake photos, all on the graphics card) and `corner_model.py` (MobileNetV3-Small with a heatmap per corner; positions by soft-argmax).

## Numbers so far (Nov 22, 2026)

- **Graphics card check:** GTX 1660 Ti Max-Q, PyTorch 2.11 with CUDA 12.8: **836 images a second** training MobileNetV3-Small (the planned corner finder's size) on 256 × 256 pictures, using 1.5 GB of the 6 GB. So 200,000 fake photos is about 4 minutes a pass; making the fake photos, not training, will set the pace.
  - Lesson: a memory layout called "channels last", which speeds up newer cards, made this card **8 times slower** (107 a second), and half precision was a bit slower than full precision (the 16-series has no tensor cores). Train in full precision with the normal layout.
- **Videos (Nov 22, 2026):** 10 surface videos (5.2 min) and 74 card videos (9.3 min), all HEVC 1920 × 1216 at 30 fps, stored sideways with a rotation note (the scripts turn them upright).
- **Fake photo generator:** about 310 photos a second at 384 × 256; training runs at about 200 a second including the generator. The JPEG effect was the slowest single step (46 ms a batch), so it and the blurs only run on the photos that use them.
- **Printings:** 120,275 printings in `default_cards`; **110,941 paper printings with pictures**, 115,080 pictures counting back faces. Languages: English 108,291, then Spanish 1,207, Japanese 652, French 430 and a few hundred more.

## Tips for long runs

- Keep the laptop plugged in, on a hard surface, and set Windows to **never sleep while plugged in** (Settings → System → Power), or a night's run stops when the screen turns off.
- A run that stops halfway just needs the same command again.
