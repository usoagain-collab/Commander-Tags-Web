// Card scanner experiment, round 7 (Nov 22, 2026): the browser side of auto scan. While the gold outline is on a
// card, every video frame's name and corner strips are flattened and added to a stack (stack.ts); a read uses the
// stack's median picture, so the longer the camera looks, the more frames back each read.
// Round 8: the live outline (found on a 320 px copy) sat a little off the card in David's picture sheet (above the
// top, past the bottom onto the table), so the first frame of each card measures the edges again at 640 px and the
// difference corrects every later frame; the strips are cut taller and trimmed to their text (stripCrops).

import { homography, houghCorners, type Pt, warp } from "./image";
import { StripStack, warpGray } from "./stack";
import { STRIP, stripCrops, TALL } from "./pipeline";
import type { Quad4 } from "./track";

const CARD_W = 630;
const CARD_H = 880;
const MAX_CARD_PX = 1600; // the card is drawn at most this tall from the video, so a 4K frame stays quick
const MARGIN = 0.07; // room around the outline, so the edge measure can see the card's real edges

type Corners = [Pt, Pt, Pt, Pt];

export class FrameCollector {
  // Frames may need lining up by up to 28 strip pixels (the live outline wobbles a little each frame).
  readonly name = new StripStack(STRIP.name.w, STRIP.name.h, 15, 28);
  readonly corner = new StripStack(STRIP.corner.w, STRIP.corner.h, 15, 28);
  private scratch = document.createElement("canvas");
  private last: { pixels: ImageData; corners: Corners } | null = null;
  private offset: Quad4 | null = null; // correction to the live outline, in fractions of the frame
  firstAt = 0; // when the first frame of this card was added
  videoSize = "";
  refined = false; // the first frame's edges were measured again

  get count() {
    return this.name.count;
  }

  reset() {
    this.name.reset();
    this.corner.reset();
    this.last = null;
    this.offset = null;
    this.firstAt = 0;
    this.refined = false;
  }

  // Add the current video frame; `tracked` is the live outline (fractions of the frame).
  add(video: HTMLVideoElement, tracked: Quad4) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    this.videoSize = `${vw}×${vh}`;
    const off = this.offset;
    const quad: Quad4 = off ? tracked.map(([x, y], i) => [x + off[i][0], y + off[i][1]]) : tracked;
    const xs = quad.map((p) => p[0] * vw);
    const ys = quad.map((p) => p[1] * vh);
    const mx = (Math.max(...xs) - Math.min(...xs)) * MARGIN;
    const my = (Math.max(...ys) - Math.min(...ys)) * MARGIN;
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - mx));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - my));
    const x1 = Math.min(vw, Math.ceil(Math.max(...xs) + mx));
    const y1 = Math.min(vh, Math.ceil(Math.max(...ys) + my));
    const k = Math.min(1, MAX_CARD_PX / Math.max(1, y1 - y0));
    const w = Math.max(1, Math.round((x1 - x0) * k));
    const h = Math.max(1, Math.round((y1 - y0) * k));
    this.scratch.width = w;
    this.scratch.height = h;
    const ctx = this.scratch.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h);
    let corners = quad.map(([x, y]) => [(x * vw - x0) * k, (y * vh - y0) * k]) as Corners;

    if (!off) {
      // First frame of this card: measure the edges at 640 px. Keep the measure only when it's near the outline
      // (within 8% of the card's size), else trust the outline.
      this.offset = tracked.map(() => [0, 0]);
      const better = this.measure(w, h);
      if (better) {
        const size = Math.hypot(w, h);
        const far = Math.max(...better.map((p, i) => Math.hypot(p[0] - corners[i][0], p[1] - corners[i][1])));
        if (far < size * 0.08) {
          const c0 = corners;
          this.offset = better.map((p, i) => [(p[0] - c0[i][0]) / k / vw, (p[1] - c0[i][1]) / k / vh]);
          corners = better;
          this.refined = true;
        }
      }
    }

    const H = homography(CARD_W, CARD_H, corners);
    this.name.add(warpGray(pixels, H, CARD_W, CARD_H, TALL.name, STRIP.name.w, STRIP.name.h));
    this.corner.add(warpGray(pixels, H, CARD_W, CARD_H, TALL.corner, STRIP.corner.w, STRIP.corner.h));
    this.last = { pixels, corners };
    if (!this.firstAt) this.firstAt = performance.now();
  }

  // The card's four edges in the scratch picture, found on a copy at most 640 px on its long side.
  private measure(w: number, h: number): Corners | null {
    const s = Math.min(1, 640 / Math.max(w, h));
    const small = document.createElement("canvas");
    small.width = Math.round(w * s);
    small.height = Math.round(h * s);
    const sctx = small.getContext("2d", { willReadFrequently: true });
    if (!sctx) return null;
    sctx.drawImage(this.scratch, 0, 0, small.width, small.height);
    const found = houghCorners(sctx.getImageData(0, 0, small.width, small.height), 1);
    return found ? (found.map(([x, y]) => [x / s, y / s]) as Corners) : null;
  }

  // What the reader gets: the stacked picture's text rows (gray, black and white), the sharpest single frame's, the
  // newest frame's, then the stacked picture at the old fixed box.
  crops() {
    return {
      // The name from 3 crops (each failed read costs time), the corner from 5.
      name: stripCrops(this.name.median(), "name", [this.name.sharpest()], false),
      line: stripCrops(this.corner.median(), "corner", [this.corner.sharpest(), this.corner.latest]),
    };
  }

  // The newest frame's card, flattened to 630 × 880, for the picture match and the review.
  card(): HTMLCanvasElement | null {
    if (!this.last) return null;
    const c = document.createElement("canvas");
    c.width = CARD_W;
    c.height = CARD_H;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(CARD_W, CARD_H);
    img.data.set(warp(this.last.pixels, homography(CARD_W, CARD_H, this.last.corners), CARD_W, CARD_H));
    ctx.putImageData(img, 0, 0);
    return c;
  }
}
