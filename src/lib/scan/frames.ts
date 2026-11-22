// Card scanner experiment, round 7 (Nov 22, 2026): the browser side of auto scan. While the gold outline is on a
// card, every video frame's name and corner strips are flattened and added to a stack (stack.ts); a read uses the
// stack's median picture, so the longer the camera looks, the more frames back each read.

import { homography, REGIONS, type Pt, warp } from "./image";
import { StripStack, warpGray } from "./stack";
import { STRIP, toOcrCanvas } from "./pipeline";
import type { Quad4 } from "./track";

const CARD_W = 630;
const CARD_H = 880;
const MAX_CARD_PX = 1600; // the card is drawn at most this tall from the video, so a 4K frame stays quick

export class FrameCollector {
  readonly name = new StripStack(STRIP.name.w, STRIP.name.h);
  readonly corner = new StripStack(STRIP.corner.w, STRIP.corner.h);
  private scratch = document.createElement("canvas");
  private last: { pixels: ImageData; corners: [Pt, Pt, Pt, Pt] } | null = null;
  firstAt = 0; // when the first frame of this card was added
  videoSize = "";

  get count() {
    return this.name.count;
  }

  reset() {
    this.name.reset();
    this.corner.reset();
    this.last = null;
    this.firstAt = 0;
  }

  // Add the current video frame; `quad` is the tracked outline (fractions of the frame).
  add(video: HTMLVideoElement, quad: Quad4) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    this.videoSize = `${vw}×${vh}`;
    const xs = quad.map((p) => p[0] * vw);
    const ys = quad.map((p) => p[1] * vh);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 4);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 4);
    const x1 = Math.min(vw, Math.ceil(Math.max(...xs)) + 4);
    const y1 = Math.min(vh, Math.ceil(Math.max(...ys)) + 4);
    const k = Math.min(1, MAX_CARD_PX / Math.max(1, y1 - y0));
    const w = Math.max(1, Math.round((x1 - x0) * k));
    const h = Math.max(1, Math.round((y1 - y0) * k));
    this.scratch.width = w;
    this.scratch.height = h;
    const ctx = this.scratch.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h);
    const corners = quad.map(([x, y]) => [(x * vw - x0) * k, (y * vh - y0) * k]) as [Pt, Pt, Pt, Pt];
    const H = homography(CARD_W, CARD_H, corners);
    this.name.add(warpGray(pixels, H, CARD_W, CARD_H, REGIONS.name, STRIP.name.w, STRIP.name.h));
    this.corner.add(warpGray(pixels, H, CARD_W, CARD_H, REGIONS.collector, STRIP.corner.w, STRIP.corner.h));
    this.last = { pixels, corners };
    if (!this.firstAt) this.firstAt = performance.now();
  }

  // What the reader gets: the stacked picture (gray, then black and white), then the newest single frame.
  crops() {
    const strip = (s: StripStack, size: { w: number; h: number }) => {
      const med = s.median();
      const out = [toOcrCanvas(med, size.w, size.h, false), toOcrCanvas(med, size.w, size.h, true)];
      if (s.latest) out.push(toOcrCanvas(s.latest, size.w, size.h, false));
      return out;
    };
    return { name: strip(this.name, STRIP.name), line: strip(this.corner, STRIP.corner) };
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
