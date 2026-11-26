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
| `uv run python -I scripts/train_corners.py --name corners-v1` | Trains the corner finder on fake photos made on the fly. Every 2,000 steps it scores itself on 1,024 fixed fake photos, on every labeled real frame (labels added during training count), and on 2 surface videos kept out of training ("no card" test). `--resume` carries on after a stop; `--init runs/<other>/last.pt` starts from another run's weights. Output in `runs/<name>/` (`log.csv`, `best.pt`, `last.pt`) | about 3.5 hours for 40,000 steps |

| `uv run python -I scripts/eval_corners.py runs/corners-v2/best.pt` | Scores a corner finder on every labeled frame, pass by pass: pass 1 looks at the whole frame, pass 2 and 3 at a crop around the previous answer cut from the full-size frame (`scanner/refine.py`). Writes `eval_3.csv` and `eval_worst.jpg` (green = label, red = pass 1, gold = last pass) next to the checkpoint. | 1 min |

### Phase 3: card recognizer

| Command | What it does | Time |
| --- | --- | --- |
| `uv run python -I scripts/build_recog_cache.py` | Packs **every** downloaded picture at 312 x 224 into `data/cache/recog_312.npy` (about 24 GB on disk; training reads it from disk, it never has to fit in memory) plus `recog_312.csv` (class number, Scryfall id, face, oracle id, artwork id, name, set, number). `--limit 2000` makes a small test cache | 10-20 min |
| `uv run python -I scripts/train_recognizer.py --check` | 60 training steps: prints pictures a second and graphics card memory, and saves 32 fake training pictures to `runs/recog-check/fakes.jpg`. The default (16 printings, 32 pictures a batch) fits the 6 GB card | 2 min |
| `uv run python -I scripts/build_recog_cache.py --limit 2000 --name recog_small` then `uv run python -I scripts/train_recognizer.py --name recog-small --cache recog_small --epochs 30 --eval-every 200` | A small proof before the long run: the real-frame score should climb (only your frames whose printing is among those 2,000 count) | 15 min |
| `uv run python -I scripts/train_recognizer.py --name recog-v2` | Trains the recognizer (EfficientNet-B0 to 128 numbers) by **pairs**: each fake photo has to match the clean picture of its own printing more than the batch's other printings, and same-card printings sit together in a batch. Every `--eval-every` steps (3,000) it scores 1,000 fake photos and your labeled frames against every printing of those cards plus 5,000 others, and saves `last.pt`. `--resume` carries on. Start long runs detached from Claude (`runs/detached.cmd`), or they stop when the Claude session ends. `--loss arcface` is the first method: it collapsed on the full cache (Nov 26, 2026) | about 9 hours (20 passes) |
| `uv run python -I scripts/build_catalog.py runs/recog-v2/best.pt` | Fingerprints every printing: `catalog.npy` (about 28 MB) and `catalog.csv` next to the checkpoint | about 5 min |
| `uv run python -I scripts/eval_recognizer.py runs/recog-v2/best.pt` | The phase 3 go / no-go on your labeled frames against the whole catalog: right card, artwork and printing, how often it would add a card on its own and get it wrong, and every miss. Add `--corners runs/corners-v2/best.pt` to flatten with the corner finder's corners instead of yours (the whole scanner minus the phone) | 1 min |

Code shared by the scripts lives in `scanner/`: `synth.py` (fake photos, all on the graphics card) and `corner_model.py` (MobileNetV3-Small with a heatmap per corner; positions by soft-argmax), `refine.py` (the zoomed-in second pass), `straighten.py` (flatten a card from its 4 corners), `recog_synth.py` (fake flattened photos: corners a few % off, sleeves, foil, glare, finger, blur, JPEG), `recog_model.py` (recognizer, pair loss, ArcFace) and `recog_data.py` (cache, same-card batches, labeled frames).

## Numbers so far (Nov 22, 2026)

- **Graphics card check:** GTX 1660 Ti Max-Q, PyTorch 2.11 with CUDA 12.8: **836 images a second** training MobileNetV3-Small (the planned corner finder's size) on 256 × 256 pictures, using 1.5 GB of the 6 GB. So 200,000 fake photos is about 4 minutes a pass; making the fake photos, not training, will set the pace.
  - Lesson: a memory layout called "channels last", which speeds up newer cards, made this card **8 times slower** (107 a second), and half precision was a bit slower than full precision (the 16-series has no tensor cores). Train in full precision with the normal layout.
- **Videos (Nov 22, 2026):** 10 surface videos (5.2 min) and 74 card videos (9.3 min), all HEVC 1920 × 1216 at 30 fps, stored sideways with a rotation note (the scripts turn them upright).
- **Fake photo generator:** about 310 photos a second at 384 × 256; training runs at about 200 a second including the generator. The JPEG effect was the slowest single step (46 ms a batch), so it and the blurs only run on the photos that use them.
- **Printings:** 120,275 printings in `default_cards`; **110,941 paper printings with pictures**, 115,080 pictures counting back faces. Languages: English 108,291, then Spanish 1,207, Japanese 652, French 430 and a few hundred more.

- **Corner finder on real frames (Nov 25, 2026, corners-v2 best):** median corner error 4.5% of the card's width, 35% of frames within 4% (go / no-go: 2% average, 95% within 4%). It finds a card in every labeled frame and says "no card" on every empty one. The zoomed-in second pass takes it to a median of 4.2% and 46% within 4%; a third pass adds nothing. Snapping each side to the strongest nearby edge (classic image processing) made it worse: blanket patterns and the black border's inner edge pull the lines. So the recognizer is trained on corners up to 4.5% off (`--corner-err`), and eval_recognizer.py `--corners` measures what that costs.

## Tips for long runs

- Keep the laptop plugged in, on a hard surface, and set Windows to **never sleep while plugged in** (Settings → System → Power), or a night's run stops when the screen turns off.
- A run that stops halfway just needs the same command again.
