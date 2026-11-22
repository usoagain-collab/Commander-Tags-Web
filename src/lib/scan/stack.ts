// Card scanner experiment, round 7 (Nov 22, 2026): build a better picture of the name and corner from many video
// frames. David: "use each frame to build a better picture of the cards". Each frame's strip is flattened onto the
// same upright card grid, nudged into line with the first frame, and the stack's middle value (median) is kept for
// every pixel: random noise cancels, and glare that moves as the hand moves is outvoted. Frames land a fraction of a
// pixel apart, so the stacked text can come out a little sharper than any single frame.
// Plain arrays only, so it runs in tests without a browser.

import type { Pixels, Rect } from "./image";

// A gray strip of the card: `region` (fractions of the upright card) seen through `H`, which maps a cardW × cardH
// upright card onto `src` (see homography in image.ts). Bilinear, out-of-picture pixels white.
export function warpGray(src: Pixels, H: number[], cardW: number, cardH: number, region: Rect, outW: number, outH: number): Uint8Array {
  const out = new Uint8Array(outW * outH);
  const sw = src.width;
  const sh = src.height;
  const d = src.data;
  const gray = (i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  for (let y = 0; y < outH; y++) {
    const cy = (region.y + ((y + 0.5) / outH) * region.h) * cardH;
    for (let x = 0; x < outW; x++) {
      const cx = (region.x + ((x + 0.5) / outW) * region.w) * cardW;
      const z = H[6] * cx + H[7] * cy + H[8];
      const u = (H[0] * cx + H[1] * cy + H[2]) / z;
      const v = (H[3] * cx + H[4] * cy + H[5]) / z;
      if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) {
        out[y * outW + x] = 255;
        continue;
      }
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = u - x0;
      const fy = v - y0;
      const a = gray((y0 * sw + x0) * 4);
      const b = gray((y0 * sw + x1) * 4);
      const c = gray((y1 * sw + x0) * 4);
      const e = gray((y1 * sw + x1) * 4);
      out[y * outW + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
    }
  }
  return out;
}

// Half size, averaging 2 × 2 blocks.
function half(img: Uint8Array, w: number, h: number): [Uint8Array, number, number] {
  const hw = Math.floor(w / 2);
  const hh = Math.floor(h / 2);
  const out = new Uint8Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const i = 2 * y * w + 2 * x;
      out[y * hw + x] = (img[i] + img[i + 1] + img[i + w] + img[i + w + 1]) / 4;
    }
  }
  return [out, hw, hh];
}

// Average difference when `img` is moved by (dx, dy) onto `ref`, sampled every `step` pixels inside a margin.
function diffAt(ref: Uint8Array, img: Uint8Array, w: number, h: number, dx: number, dy: number, margin: number, step: number): number {
  let sum = 0;
  let n = 0;
  for (let y = margin; y < h - margin; y += step) {
    for (let x = margin; x < w - margin; x += step) {
      sum += Math.abs(ref[y * w + x] - img[(y - dy) * w + (x - dx)]);
      n++;
    }
  }
  return n ? sum / n : Infinity;
}

// The whole-pixel move (dx, dy) that best lines `img` up with `ref`, up to `max` pixels each way: searched on half-size
// copies first, then checked to one pixel at full size, so it stays quick on a phone.
export function alignShift(ref: Uint8Array, img: Uint8Array, w: number, h: number, max = 12): [number, number] {
  const [r2, w2, h2] = half(ref, w, h);
  const [i2] = half(img, w, h);
  const m2 = Math.ceil(max / 2);
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let dy = -m2; dy <= m2; dy++) {
    for (let dx = -m2; dx <= m2; dx++) {
      const s = diffAt(r2, i2, w2, h2, dx, dy, m2, 2);
      if (s < best) [best, bx, by] = [s, dx, dy];
    }
  }
  const margin = max + 1;
  let fx = bx * 2;
  let fy = by * 2;
  best = Infinity;
  const cx = fx;
  const cy = fy;
  for (let dy = cy - 1; dy <= cy + 1; dy++) {
    for (let dx = cx - 1; dx <= cx + 1; dx++) {
      if (Math.abs(dx) > max || Math.abs(dy) > max) continue;
      const s = diffAt(ref, img, w, h, dx, dy, margin, 2);
      if (s < best) [best, fx, fy] = [s, dx, dy];
    }
  }
  return [fx, fy];
}

// `img` moved by (dx, dy); pixels moved in from outside copy the nearest edge.
export function shiftImage(img: Uint8Array, w: number, h: number, dx: number, dy: number): Uint8Array {
  if (!dx && !dy) return img;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(h - 1, Math.max(0, y - dy));
    for (let x = 0; x < w; x++) out[y * w + x] = img[sy * w + Math.min(w - 1, Math.max(0, x - dx))];
  }
  return out;
}

// The middle value of every pixel across the frames.
export function medianImage(frames: Uint8Array[], len: number): Uint8Array {
  const out = new Uint8Array(len);
  const n = frames.length;
  if (!n) return out;
  const buf = new Uint8Array(n);
  for (let i = 0; i < len; i++) {
    // Insertion sort: a handful of values per pixel.
    for (let k = 0; k < n; k++) {
      const v = frames[k][i];
      let j = k - 1;
      while (j >= 0 && buf[j] > v) {
        buf[j + 1] = buf[j];
        j--;
      }
      buf[j + 1] = v;
    }
    out[i] = n % 2 ? buf[(n - 1) >> 1] : (buf[n / 2 - 1] + buf[n / 2]) >> 1;
  }
  return out;
}

// One strip's frames, each already lined up with the first one kept. At most `limit` (newest kept; the first stays
// as the reference everything is lined up with).
export class StripStack {
  private ref: Uint8Array | null = null;
  private frames: Uint8Array[] = [];
  latest: Uint8Array | null = null;
  constructor(
    readonly w: number,
    readonly h: number,
    private readonly limit = 15,
    private readonly maxShift = Math.max(4, Math.round(w * 0.012)),
  ) {}

  get count() {
    return this.frames.length;
  }

  reset() {
    this.ref = null;
    this.frames = [];
    this.latest = null;
  }

  add(img: Uint8Array) {
    this.latest = img;
    if (!this.ref) {
      this.ref = img;
      this.frames.push(img);
      return;
    }
    const [dx, dy] = alignShift(this.ref, img, this.w, this.h, this.maxShift);
    this.frames.push(shiftImage(img, this.w, this.h, dx, dy));
    if (this.frames.length > this.limit) this.frames.splice(1, 1); // keep the reference frame, drop the oldest after it
  }

  median(): Uint8Array {
    return medianImage(this.frames, this.w * this.h);
  }
}
