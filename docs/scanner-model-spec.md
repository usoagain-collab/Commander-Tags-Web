# Scanner models: training our own on the laptop

Draft, Nov 22, 2026; revised Nov 27, 2026 after the DINOv2 result and an architecture review. Goal from David: scanning as fast and accurate as ManaBox, or better. Research behind this: `docs/spec.md` → "Card scanner research" and "How ManaBox gets it fast and right".

## Summary

Two neural networks, trained or tuned on David's laptop from Scryfall's card images, running in the phone's browser:

1. **Corner finder**: looks at the camera picture and puts a dot on each of the card's 4 corners, even when the card is tilted, on a busy table, or under a finger. Replaces today's edge finder (`houghCorners`), our weakest step.
2. **Card recognizer**: looks at the straightened card and turns it into a "fingerprint" of numbers. The same printing gives nearly the same numbers in any light; different printings give different numbers. The closest fingerprint in a catalog of every printing, grouped by artwork, picks the card. Since Nov 27, 2026 it starts from Meta's DINOv2 ViT-S/14 (Apache 2.0), not our own EfficientNet (see Phase 3).
3. **The corner reading we already built** (set code and collector number) picks the printing among those that share the art (2015+ frames); older frames use the set symbol and border, and when it's still unclear the scanner shows the candidates as pictures for one tap.
4. **Several frames per card**, not one: blurred or glary frames are dropped and 3-5 sharp ones must agree before a card is added.

This is the design CardVision and CollectorVision use. Nothing is AGPL and nothing costs per scan.

**Size on the phone (to be measured, Phase 3):** about 3 MB corner finder + a 22-44 MB DINOv2 recognizer + a 15-44 MB catalog, downloaded once. If that's too big or too slow on iPhone Safari, we distill DINOv2 into a phone-sized model (planned 5 MB recognizer and 14-28 MB catalog).

**Rough time:** 4-6 weeks part-time was the Nov 22 estimate; at day 5 we are in phase 3. Revised: 2-3 more weeks if DINOv2 ships as is, 4-5 if it must be distilled for the phone. Most of it is unattended runs overnight. Each phase ends with a go / no-go on real photos of David's cards, so we find out early if something isn't working.

## The laptop

| Part | What it has | What it means |
| --- | --- | --- |
| Graphics card | GTX 1660 Ti Max-Q, 6 GB | Enough for small models. Slower than a desktop card: a training run is a night, not an hour |
| Processor | Ryzen 7 3750H, 4 cores | Too few to make fake photos fast enough for the graphics card, so the photo effects run on the graphics card too (kornia library) |
| Memory | 16 GB | Fine |
| Disk | 272 GB free | Needs about 15 GB (card images, fake photos, runs) |

Keep it plugged in and on a hard surface during runs; a thin laptop slows itself down when hot. If we ever want speed, a rented cloud graphics card costs a few dollars a run and the same code runs there unchanged.

## Ground rules

- **License-clean:** plain PyTorch and torchvision (BSD), kornia (Apache-2.0), onnxruntime (MIT), DINOv2 (Apache-2.0; credit and license text when shipped). **No Ultralytics YOLO** (AGPL) and no CollectorVision code or weights (AGPL). Starting weights: torchvision's ImageNet weights (the usual starting point for small models, used commercially all over).
- **Training pictures come from Scryfall's own card images**, which Scryfall provides for making Magic software. The catalog we ship is numbers worked out from those images, not the images. If in doubt, ask Scryfall.
- **Backgrounds come from David's own videos** of his tables, desk, playmats, binders and sofa, plus computer-made textures. No downloaded photo collections with unclear licenses.
- **Real photos decide everything.** Fake photos train the models; only David's real photos and videos say whether they're good.

## Where it lives

- New folder `ml/` in the repo: Python code, its own `README.md`, run with `uv` on Python 3.12 (PyTorch may not support the 3.14 already installed).
- Not committed: `ml/data/` (images, videos, fake photos) and `ml/runs/` (training output). Finished models (ONNX files, a few MB) and the catalog go to storage, not git (see open decisions).
- Browser side stays in `src/lib/scan/` and `/admin/scan-lab`, as now.

## Phase 0: set up (one evening)

- Install `uv`, Python 3.12, PyTorch with CUDA; a 1-minute check that training runs on the graphics card.
- Download Scryfall's `default_cards` list (every printing; we don't store all printings in our database, they don't fit) and keep paper printings with images: about 110,000.
- Download each printing's `normal` image (488 × 680), shrunk to 320 px tall and saved as JPEG: about 3 GB. At 10 a second that's about 3 hours, run unattended, resumable.
- **Done Nov 22, 2026** (`ml/`, see its README): the graphics card trains MobileNetV3-Small at **836 images a second** (full precision; the "channels last" layout made it 8 times slower on this card). 110,941 paper printings with pictures, 115,080 pictures counting back faces; the picture download (about 3.7 GB, 3.2 hours) runs from `scripts/download_images.py`.

## Phase 1: real test set (David, about 2 hours spread out)

Nothing else is trustworthy without this.

- **Surfaces:** about 10 short videos (30 s each) of places you'd scan on, with no cards: table, desk, towel, playmat, sofa, binder page, a stack of other cards. Frames from these become training backgrounds.
- **Cards:** short videos of about 150 of your own cards, one card each, held still then tilted, some with a finger on a corner, some sleeved, some in bad light. Mix: Star Trek foils, reprint-heavy staples (Sol Ring, Command Tower, basics), showcase and borderless, pre-2015 frames, a few non-English.
- **Labels:** (built Nov 22, 2026 as a page served from the laptop, `ml/scripts/label_server.py`, instead of a scan lab tab: frames and labels live in `ml/data/`, and browsers play HEVC phone video unreliably.) Originally planned as a new tab in the scan lab: pick a frame, tap the 4 corners (the current edge finder suggests them, you fix them), and pick the printing from its pictures (the lab already does this part). About 300 labeled frames in total. Some go into a fine-tune set, the rest are the test set the models never see.
- **Status Nov 27, 2026:** 101 frames of 25 cards, mostly Star Trek, Secret Lair and showcase frames. Too few and too narrow (one card moves a score 3-7%). Second shoot of about 150 everyday cards planned, with the checklist below. The split is by card and decided before training: about 100 cards locked as the test, the other 50 may train.

**Second shoot checklist (about 150 cards, one 5-8 s clip each):**

- **Cards:** 40 modern commons and uncommons (2015+ frames); 20 basics from different sets; 15 heavily reprinted staples (Sol Ring, Command Tower, Arcane Signet, Counterspell…); 20 from 2003-2014 frames; 10 old-border (pre-2003); 10 borderless, showcase or extended art; 10 foils (any etched too); 5 double-faced (both faces); 5 non-English; 10 that share art with another printing owned (shoot both).
- **Sleeves, spread across cards:** bare about 50%, matte sleeve 20%, glossy sleeve 15%, binder page 10%, toploader 5%.
- **Light:** daylight, warm overhead, dim lamp, a few with glare on purpose.
- **Surfaces:** table, playmat, held in hand, on top of a stack.
- **Angles:** about 10 clips upside-down, a few sideways. Hold still about 1 s, then tilt slowly.
- **Second phone:** about 20 cards on another phone, so the model doesn't learn one camera.
- **Names:** name each clip `card-name_set_sleeve_light.mov` (e.g. `sol-ring_c21_glossy_dim.mov`) or keep a list, so printings don't need labeling by hand.

## Phase 2: corner finder (1-2 weeks)

**Status (Nov 22, 2026):** fake photo generator (`ml/scanner/synth.py`), model (`ml/scanner/corner_model.py`) and training (`ml/scripts/train_corners.py`) built; first run `corners-v1` (40,000 steps, about 2.6 million fake photos, 384 x 256 portrait input instead of 256 x 256 because phone frames are portrait) started overnight. Two of the 10 surface videos are kept out of training as the "no card" test.

**Fake photos, made on the fly** (never the same twice):

- A card image with rounded corners, placed on a background frame at any rotation, tilted up to about 50° (perspective), 15-90% of the picture.
- Clutter: other cards around and under it, partly overlapping; a skin-colored finger shape over a corner or an edge.
- Camera effects: motion blur, out of focus, glare spots and sleeve sheen, foil rainbow sheen, shadows, dim and warm light, noise, JPEG blockiness.
- 20% with no card at all, so it learns to say "no card".

**Model:** MobileNetV3-Small (about 1.5 M settings to learn) with a small "heatmap" head that marks each corner, plus a "card present" score and a "this corner is hidden" score per corner. Input 256 × 256, corners named by the card's own top-left, so it also knows which way up the card is. About 3 MB.

**Training:** about 200,000 fake photos per run, a night each. Then a short fine-tune on the ~150 labeled real frames if the fake-only model falls short.

**Go / no-go on the real test set:**

- Corners within 2% of the card's width on average, 95% of frames within 4%.
- "No card" correct on 99% of empty frames.
- Under 50 ms a frame in Chrome on David's phone.
- Side by side with today's `houghCorners` in the lab: clearly better, or we stop and rethink.

## Phase 3: card recognizer (revised Nov 27, 2026)

**Where it stands:** our own trained models stalled on real frames; Meta's DINOv2 ViT-S/14 with no training beat them by nearly 3 times. The plan below starts from DINOv2 and measures before training anything.

### Results so far

All on the 101 real frames (25 cards, 3-7 frames each) with hand-labeled corners, searched against all 115,080 printings.

| Run | What it was | Right card (top 1 / top 5) | Right printing (top 1 / top 5) |
| --- | --- | --- | --- |
| recog-v1, Nov 26 | EfficientNet-B0, ArcFace, one class per printing | 16% at step 1,000, then 0% (collapsed: every picture got the same fingerprint) | - |
| recog-v2, Nov 26-27 | EfficientNet-B0, photo / clean-picture pairs (`pair_loss`), batch norm shift fixed at 0, backbone lr 1e-4 | 27.7% / 47.5% | 27.7% / 44.6% |
| recog-v3 best (step 2,000), Nov 27 | As v2, fakes made hazy, warm and phone-smoothed to match David's frames | 21.8% / 34.7% | 18.8% / 28.7% |
| recog-v3 last (step 28,000) | same | 15.8% / 33.7% | 9.9% / 29.7% |
| **DINOv2 ViT-S/14, no training**, Nov 27 | Meta's ready-made model, CLS token, L2-normalized, 224 wide | **76.2% / 82.2%** | **58.4% / 80.2%** |

DINOv2 with averaged patch tokens instead of the CLS token: 70.3% card, 57.4% printing. DINOv2 found 22 of the 25 cards at least once. Fingerprinting the whole catalog took 17 minutes on the laptop.

**What the runs taught us:**

- Fake photos were the weak link, not the model size. v2 and v3 scored 97-98% on fakes and under 30% on real frames. Matching the fakes' brightness, color and sharpness to David's frames (v3) made real frames worse.
- A model trained on 142 million general photos already sees past haze and color casts. Start from it.
- Every v2 miss was the wrong card. DINOv2's 18-point gap between card and printing is mostly same-art printings (reprints with identical art), which a global fingerprint can't separate well.
- 25 cards is too few to trust: one card flipping moves the score 3-7%.

**License:** DINOv2 code and weights are Apache 2.0 (checked in the downloaded README). Shipping it (even fine-tuned or shrunk) needs the license text beside the model file and a credit line on the site ("Card recognition built on DINOv2 by Meta AI, Apache License 2.0"), and no suggestion that Meta endorses us. The same repository's X-ray DINO and Cell-DINO weights are noncommercial: never use them. Check the license of any other model (DINOv3 and others) before trying it.

### Design

**Stage 1, which card:** a DINOv2 fingerprint of the straightened card, searched against a catalog of every printing. Results are grouped by artwork (`illustration_id`) before deciding. The catalog stays one entry per printing (or per artwork plus frame style), because Scryfall gives a normal printing and its borderless, extended or showcase version the same `illustration_id`, and those look nothing alike as whole cards. The catalog is shrunk by PCA and quantization, measured below, not by merging printings.

**Stage 2, which printing:** only among the printings that share the winning artwork (usually 2-20).

- 2015+ frames: the corner reading (set code and collector number) we already built picks one.
- Older frames (no bottom-left code): set symbol, border color and frame era from small crops, else the one-tap picker.
- Still unclear: show the candidates as pictures for one tap. Never save a guess silently.

**Several frames, not one:** a sharpness and glare gate drops blurred or blown-out frames. Then the fingerprints of 3-5 sharp frames are averaged (L2-normalized), or 2 of 3 frames must agree with a clear margin over the runner-up. Auto-add only past that bar.

**Upside-down cards:** the corner finder labels the card's own top-left first, so it already predicts orientation. Measure how often it gets 180 degrees wrong; if it matters, also search the 180-degree turned crop and keep the better score.

**Training, only after the benchmarks below:**

1. Keep the DINOv2 backbone frozen. Train a small projection head (or a LoRA adapter) that maps camera fingerprints into the clean-picture space, on synthetic pairs from all 115,080 printings plus a small set of real frames.
2. Only if the head stalls on the locked test: tune the last few DINOv2 blocks at a low learning rate on synthetic pairs. The worry about forgetting applies to training on 150 real cards alone, not to the full synthetic set, but it is judged on the locked test only.
3. Never tune settings against the locked test.

**Real-frame split, decided by card before any training:** about 100 cards are the locked test (the current 25 plus 75 new). The other 50 cards' frames may be used for training. The same card is never in both. Measuring 98% honestly needs about 300 test cards eventually: with 100 cards, one miss is 1%.

### Benchmarks to run first (no training)

**On the laptop, the 101 frames (then the new set):**

| Test | Variants | Answers |
| --- | --- | --- |
| Corner error vs recognizer error | DINOv2 on (a) hand corners, (b) corners-v2 corners, (c) corners-v2 plus the zoom pass (`refine.py`), (d) hand corners nudged 2% and 4% | How much of the 23.8% card miss is warp error |
| Catalog size | 384-dim fp16, 384-dim int8, PCA to 128 plus int8, product quantization; by printing vs grouped by artwork | Smallest catalog that keeps accuracy |
| Several frames | Average of 3-5 sharp frames; 2-of-3 agreement with a margin | Right card, and wrong-but-confident rate |
| Upside-down | Frames turned 180 degrees | Whether orientation needs its own check |
| Old method baseline | The scan lab's current OCR plus picture match, run in a headless browser on the laptop | The floor to beat |

**On David's phones (iPhone Safari, Android Chrome), a test page:**

- ViT-S/14 at fp32, fp16 and int8; WASM one thread, WASM threads, WebGPU where available.
- Measure: download size, cold start, peak memory (on iPhone, whether the tab survives), median time per card over 20 runs, and search time over 115,080 fingerprints at each catalog size; the corner finder runs alongside.
- WASM threads and WebGPU only work on a secure (https) page with cross-origin isolation, so the test files (22-88 MB) can't be served from a plain laptop address. Options: a temporary Cloudflare tunnel from the laptop (new software, David's OK), or Supabase Storage (50 MB per file limit, so split the catalog).
- **Pass:** under 300 ms per card, the tab survives on iPhone, first download under about 40 MB. Otherwise distill: train a phone-sized model to copy DINOv2's fingerprints on the synthetic pairs.

### Size budget (replaces the 5 MB recognizer and 14-28 MB catalog)

| Part | Before | DINOv2, to be measured |
| --- | --- | --- |
| Recognizer | EfficientNet-B0, about 5 MB | ViT-S/14: about 88 MB fp32, 44 MB fp16, 22 MB int8 |
| Catalog, 115,080 printings | 128-dim: 28 MB fp16, 14 MB int8 | 384-dim: 88 MB fp16, 44 MB int8; PCA to 128 plus int8: about 15 MB |
| Corner finder | about 3 MB | same |

The ONNX runtime and card metadata come on top.

### Go / no-go on the locked test (unchanged)

- Right card: 98%+ (after several frames).
- Right printing: 90%+ from the picture alone; 95%+ with the corner reading.
- Wrong and confident: under 1%.
- Under 300 ms per recognition in the phone browser.
- Compared on the same cards against ManaBox and the scan lab's old method.

### Kept for the record

`train_recognizer.py` (pairs, default) and `--loss arcface` stay in the repo. ArcFace collapsed with one picture per class across 115k classes; pairs did not collapse but stalled on real frames.

## Phase 4: in the scan lab (1-2 weeks)

- Both models run in the browser with `onnxruntime-web` in a background worker (WASM; WebGPU if it proves reliable on phones).
- Every camera frame: corner finder, gold outline drawn on the card. Sharp, glare-free frames are straightened, recognized and searched (a plain comparison against 115,080 fingerprints; time measured in phase 3), and 3-5 of them must agree.
- **Frames agree and the card is clearly ahead of the runner-up:** add it, with a beep, no tap.
- **Several printings share the art:** read the corner (our existing code) on 2015+ frames, set symbol and border on older ones, to pick one.
- **Still unclear, or score low:** show the top candidates as pictures; one tap picks.
- Foil and language stay a one-tap switch and a batch setting; never guessed from glare.
- The lab records time per card and right / wrong, like now.

**Done when:** David's verdict on his own cards is "as good as ManaBox". Then the scanner leaves the lab and becomes the collection scanner (the v3 backlog item).

## Phase 5: keeping it current

- **New sets:** the nightly import embeds new printings with the same model (`onnxruntime-node` in the TypeScript import script, no Python on the server) and updates the catalog. The phone fetches only what changed.
- **Retrain** only when a new frame style trips it up (a few times a year at most), using the saved test set to make sure nothing got worse.

## Risks

| Risk | What we do |
| --- | --- |
| Fake photos don't look like real ones, so models that score well on fakes fail on the phone | **Happened (recog-v2, v3).** Start from DINOv2, which already handles real frames; frozen backbone plus a small head; real frames from training cards mixed in; the locked test decides |
| Same-art reprints stay hard (Sol Ring) | Stage 2 only among printings sharing the art: corner reading on 2015+ frames, set symbol and border on older ones, candidates for one tap; never save a guess silently |
| Laptop too slow or overheats | Smaller images or fewer passes first; a rented cloud graphics card as the fallback, same code |
| iPhone Safari runs the models slowly or runs out of memory | DINOv2 is about 4-9 times bigger than the planned recognizer. Phone test page before any training (phase 3); int8; recognition only on sharp, still frames; distill into a phone-sized model if it fails |
| The catalog download is big on mobile data | 384 numbers per printing is 44 MB at 8 bits. Measure PCA to 128 plus 8 bits (about 15 MB) and product quantization; say the size before downloading; browser keeps it |
| Fast in-browser threads need special page headers (cross-origin isolation) that can block outside images | Only on the scanner page; check that Scryfall images still load with them |
| The test set is too small to prove 98% | Lock about 100 cards now, grow toward 300; report every score with its card count |
| The corner finder (4.5% miss) spoils crops and clips the collector line | Benchmark DINOv2 on hand corners vs corners-v2 corners first; improve corners only if they cost real accuracy |

## Open decisions for David

1. **Where the catalog and model files live** (downloaded by every scanner user): Supabase Storage counts against the free plan's monthly download allowance; Cloudflare R2 has free downloads but is a new account; Vercel Blob is in the existing Vercel project. Recommendation: decide at phase 4, when the size is known.
2. **Fine-tune on real frames:** decided Nov 27, 2026, frozen DINOv2 plus a small head on synthetic pairs and the 50 training cards' frames, after the benchmarks.
4. **Where the phone test files live** (22-88 MB, needs https): a temporary Cloudflare tunnel from the laptop (new software) or Supabase Storage (50 MB per file). Recommendation: the tunnel, for testing only.
3. **Which printings:** all paper printings back to 1993 (recommended; old cards are where text reading fails worst), or skip some (art series, oversized, tokens) to shrink the catalog.

## What David does

- Phase 1 videos and labels (about 2 hours over a few days).
- Leave the laptop plugged in overnight during training runs.
- Try each phase's result on his phone and give the verdict.
- The catalog hosting decision.
