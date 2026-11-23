# Scanner models: training our own on the laptop

Draft, Nov 22, 2026. Goal from David: scanning as fast and accurate as ManaBox, or better. Research behind this: `docs/spec.md` → "Card scanner research" and "How ManaBox gets it fast and right".

## Summary

Two small neural networks, trained on David's laptop from Scryfall's card images, running in the phone's browser:

1. **Corner finder**: looks at the camera picture and puts a dot on each of the card's 4 corners, even when the card is tilted, on a busy table, or under a finger. Replaces today's edge finder (`houghCorners`), our weakest step.
2. **Card recognizer**: looks at the straightened card and turns it into 128 numbers (a "fingerprint"). The same printing gives nearly the same numbers in any light; different printings give different numbers. The closest fingerprint in a catalog of every printing wins.
3. **The corner reading we already built** (set code and collector number) only breaks ties between printings that share their art, and when it's still unclear the scanner shows the candidates as pictures for one tap.

This is the design CardVision and CollectorVision use. Ours is trained from scratch so nothing is AGPL and nothing costs per scan.

**Size on the phone:** about 3 MB corner finder + about 5 MB recognizer + a 14-28 MB catalog, downloaded once when you open the scanner.

**Rough time:** 4-6 weeks part-time, most of it unattended training runs overnight. Each phase ends with a go / no-go on real photos of David's cards, so we find out early if something isn't working.

## The laptop

| Part | What it has | What it means |
| --- | --- | --- |
| Graphics card | GTX 1660 Ti Max-Q, 6 GB | Enough for small models. Slower than a desktop card: a training run is a night, not an hour |
| Processor | Ryzen 7 3750H, 4 cores | Too few to make fake photos fast enough for the graphics card, so the photo effects run on the graphics card too (kornia library) |
| Memory | 16 GB | Fine |
| Disk | 272 GB free | Needs about 15 GB (card images, fake photos, runs) |

Keep it plugged in and on a hard surface during runs; a thin laptop slows itself down when hot. If we ever want speed, a rented cloud graphics card costs a few dollars a run and the same code runs there unchanged.

## Ground rules

- **License-clean:** plain PyTorch and torchvision (BSD), kornia (Apache-2.0), onnxruntime (MIT). **No Ultralytics YOLO** (AGPL) and no CollectorVision code or weights (AGPL). Starting weights: torchvision's ImageNet weights (the usual starting point for small models, used commercially all over).
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
- **Labels:** a new tab in the scan lab: pick a frame, tap the 4 corners (the current edge finder suggests them, you fix them), and pick the printing from its pictures (the lab already does this part). About 300 labeled frames in total. Some go into a fine-tune set, the rest are the test set the models never see.

## Phase 2: corner finder (1-2 weeks)

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

## Phase 3: card recognizer (2-3 weeks)

**Training pictures:** the same fake photos, then straightened using the true corners nudged by 2-3% (so it learns to cope with a corner finder that's slightly off), at 224 × 312.

**Model:** EfficientNet-B0 (about 5 M settings), ending in 128 numbers. Trained with **ArcFace**, the face-recognition method: every printing is its own "person", about 110,000 of them, and the model learns to put the same printing close together and different ones apart. Printings with the same name but another set are deliberately put in the same training batches, so it learns the small differences: set symbol, frame, border, collector line.

**Catalog:** run the finished model on every printing's clean Scryfall image (plus a few lightly altered copies, averaged) and store the 128 numbers per printing: 28 MB at half precision, or 14 MB at 8 bits if accuracy holds. Plus each printing's Scryfall id.

**Training:** about 20 passes over all printings, roughly 1-2 nights a run on the laptop.

**Go / no-go on the real test set:**

- Right card: 98%+ (first guess).
- Right printing: 90%+ from the picture alone; 95%+ with the corner reading as tie-breaker.
- Wrong and confident: under 1% (a low score must ask, not guess).
- Under 300 ms per recognition in Chrome on David's phone.
- Compared on the same videos against CollectorVision and ManaBox.

## Phase 4: in the scan lab (1 week)

- Both models run in the browser with `onnxruntime-web` in a background worker (WASM; WebGPU if it proves reliable on phones).
- Every camera frame: corner finder, gold outline drawn on the card. When the corners hold still for 2-3 frames: straighten, recognize, search the catalog (a plain comparison against 110,000 fingerprints, about 15 ms).
- **Score high and clearly ahead of the runner-up:** add it, with a beep, no tap.
- **Several printings close:** read the corner (our existing code) to pick one.
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
| Fake photos don't look like real ones, so models that score well on fakes fail on the phone | David's surface videos as backgrounds; a small fine-tune on real labeled frames; the real test set decides every phase |
| Same-art reprints stay hard (Sol Ring) | Corner reading as tie-breaker; candidates for one tap; never save a guess silently |
| Laptop too slow or overheats | Smaller images or fewer passes first; a rented cloud graphics card as the fallback, same code |
| iPhone Safari runs the models slowly | Measure in phase 2 with the first model; the corner finder can run on a smaller picture; recognition only runs when the card holds still |
| The catalog download is big on mobile data | 8-bit catalog (14 MB) if accuracy holds; say the size before downloading; browser keeps it |
| Fast in-browser threads need special page headers (cross-origin isolation) that can block outside images | Only on the scanner page; check that Scryfall images still load with them |

## Open decisions for David

1. **Where the catalog and model files live** (downloaded by every scanner user): Supabase Storage counts against the free plan's monthly download allowance; Cloudflare R2 has free downloads but is a new account; Vercel Blob is in the existing Vercel project. Recommendation: decide at phase 4, when the size is known.
2. **Fine-tune on real frames** (about an hour of tapping corners in the lab) if fake-only falls short. Recommendation: yes, only if needed.
3. **Which printings:** all paper printings back to 1993 (recommended; old cards are where text reading fails worst), or skip some (art series, oversized, tokens) to shrink the catalog.

## What David does

- Phase 1 videos and labels (about 2 hours over a few days).
- Leave the laptop plugged in overnight during training runs.
- Try each phase's result on his phone and give the verdict.
- The catalog hosting decision.
