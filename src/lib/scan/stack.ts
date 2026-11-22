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

// Average difference when `img` is moved by (dx, dy) onto `ref`, sampled every `step` pixels inside a margin and
// between columns x0 and x1.
function diffAt(ref: Uint8Array, img: Uint8Array, w: number, h: number, dx: number, dy: number, margin: number, step: number, x0 = 0, x1 = w): number {
  let sum = 0;
  let n = 0;
  const xa = Math.max(margin, Math.ceil(x0));
  const xb = Math.min(w - margin, Math.floor(x1));
  for (let y = margin; y < h - margin; y += step) {
    for (let x = xa; x < xb; x += step) {
      sum += Math.abs(ref[y * w + x] - img[(y - dy) * w + (x - dx)]);
      n++;
    }
  }
  return n ? sum / n : Infinity;
}

// A picture at full, half and quarter size, built once per frame and shared by both halves' searches.
export type Pyramid = [[Uint8Array, number, number], [Uint8Array, number, number], [Uint8Array, number, number]];
export function pyramid(img: Uint8Array, w: number, h: number): Pyramid {
  const l1 = half(img, w, h);
  return [[img, w, h], l1, half(l1[0], l1[1], l1[2])];
}

// The whole-pixel move (dx, dy) that best lines `img` up with `ref` between columns x0 and x1, up to `max` pixels each
// way. Round 9: searched on quarter-size copies, then checked to one pixel at half and at full size, so a larger
// reach (David's ghosted corners needed it) stays quick on a phone.
export function alignShift(ref: Uint8Array, img: Uint8Array, w: number, h: number, max = 12, x0 = 0, x1 = w): [number, number] {
  return alignPyramids(pyramid(ref, w, h), pyramid(img, w, h), max, x0, x1);
}

export function alignPyramids(ref: Pyramid, img: Pyramid, max = 12, x0 = 0, x1 = ref[0][1]): [number, number] {
  const [[r1, w, h], [r2, w2, h2], [r4, w4, h4]] = ref;
  const [[i1], [i2], [i4]] = img;
  const m4 = Math.ceil(max / 4);
  // The best rough moves on the quarter-size copies, each then refined: text repeats (letters, a pattern), so the
  // single best rough move can be the wrong one.
  const rough: [number, number, number][] = [];
  for (let dy = -m4; dy <= m4; dy++) {
    for (let dx = -m4; dx <= m4; dx++) rough.push([diffAt(r4, i4, w4, h4, dx, dy, m4 + 1, 1, x0 / 4, x1 / 4), dx, dy]);
  }
  rough.sort((a, b) => a[0] - b[0]);
  // One pixel either way at a finer size, around (cx, cy); returns the move and its difference.
  const refine = (r: Uint8Array, im: Uint8Array, ww: number, hh: number, cx: number, cy: number, reach: number, scale: number, step: number): [number, number, number] => {
    let b = Infinity;
    let fx = cx;
    let fy = cy;
    for (let dy = cy - 1; dy <= cy + 1; dy++) {
      for (let dx = cx - 1; dx <= cx + 1; dx++) {
        if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
        const s = diffAt(r, im, ww, hh, dx, dy, reach + 1, step, x0 / scale, x1 / scale);
        if (s < b) [b, fx, fy] = [s, dx, dy];
      }
    }
    return [fx, fy, b];
  };
  // Narrow down at half size first, then check only the two best at full size.
  const halves = rough
    .slice(0, 4)
    .map(([, rx, ry]) => refine(r2, i2, w2, h2, rx * 2, ry * 2, Math.ceil(max / 2), 2, 2))
    .sort((a, b) => a[2] - b[2]);
  let best: [number, number, number] = [0, 0, Infinity];
  for (const [hx, hy] of halves.slice(0, 2)) {
    const full = refine(r1, i1, w, h, hx * 2, hy * 2, max, 1, 3);
    if (full[2] < best[2]) best = full;
  }
  return [best[0], best[1]];
}

// `img` moved by (dx, dy); pixels moved in from outside copy the nearest edge.
export function shiftImage(img: Uint8Array, w: number, h: number, dx: number, dy: number): Uint8Array {
  if (!dx && !dy) return img;
  return shiftTilted(img, w, h, [dx, dy], [dx, dy]);
}

// `img` moved by `left` at a quarter of the way across and by `right` at three quarters, in between (and beyond) in
// proportion: a small turn as well as a shift, which a plain shift can't line up across a long strip.
export function shiftTilted(img: Uint8Array, w: number, h: number, left: [number, number], right: [number, number]): Uint8Array {
  const out = new Uint8Array(w * h);
  const dxs = new Int32Array(w);
  const dys = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    const t = (x - w / 4) / (w / 2);
    dxs[x] = Math.round(left[0] + (right[0] - left[0]) * t);
    dys[x] = Math.round(left[1] + (right[1] - left[1]) * t);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sy = Math.min(h - 1, Math.max(0, y - dys[x]));
      const sx = Math.min(w - 1, Math.max(0, x - dxs[x]));
      out[y * w + x] = img[sy * w + sx];
    }
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

// How sharp a picture is: the average brightness change between neighbors (a blurred frame has less).
function sharpness(img: Uint8Array, w: number, h: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 1; x < w; x += 2) {
      sum += Math.abs(img[y * w + x] - img[y * w + x - 1]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

interface Frame {
  img: Uint8Array; // lined up with the reference
  misfit: number; // how unlike the reference it still is after lining up
  sharp: number;
}

// One strip's frames, each lined up with the first one kept (its left and right halves separately, so a slight turn
// between frames lines up too). At most `limit` (newest kept; the first stays as the reference). The median only
// uses frames that lined up well (round 9: frames that didn't made the ghosted corners in David's picture sheet).
export class StripStack {
  private ref: Uint8Array | null = null;
  private refPyr: Pyramid | null = null;
  private frames: Frame[] = [];
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
    this.refPyr = null;
    this.frames = [];
    this.latest = null;
  }

  add(img: Uint8Array) {
    this.latest = img;
    const { w, h, maxShift } = this;
    if (!this.ref || !this.refPyr) {
      this.ref = img;
      this.refPyr = pyramid(img, w, h);
      this.frames.push({ img, misfit: 0, sharp: sharpness(img, w, h) });
      return;
    }
    const mid = Math.floor(w / 2);
    const pyr = pyramid(img, w, h);
    const left = alignPyramids(this.refPyr, pyr, maxShift, 0, mid);
    const right = alignPyramids(this.refPyr, pyr, maxShift, mid, w);
    const lined = shiftTilted(img, w, h, left, right);
    const misfit = diffAt(this.ref, lined, w, h, 0, 0, maxShift + 1, 3);
    this.frames.push({ img: lined, misfit, sharp: sharpness(lined, w, h) });
    if (this.frames.length > this.limit) this.frames.splice(1, 1); // keep the reference frame, drop the oldest after it
  }

  // The frames that lined up well: within 1.6 times the typical misfit (at least the best 3).
  private good(): Frame[] {
    if (this.frames.length <= 3) return this.frames;
    const others = this.frames.slice(1).map((f) => f.misfit).sort((a, b) => a - b);
    const typical = others[Math.floor(others.length / 2)];
    const keep = this.frames.filter((f) => f.misfit <= typical * 1.6 + 2);
    return keep.length >= 3 ? keep : [...this.frames].sort((a, b) => a.misfit - b.misfit).slice(0, 3);
  }

  median(): Uint8Array {
    return medianImage(this.good().map((f) => f.img), this.w * this.h);
  }

  // The sharpest single frame among those that lined up well.
  sharpest(): Uint8Array | null {
    let best: Frame | null = null;
    for (const f of this.good()) if (!best || f.sharp > best.sharp) best = f;
    return best?.img ?? null;
  }
}

export interface BandOptions {
  mergeGap?: number; // busy runs this close join (the corner's two lines)
  maxRows?: number; // taller runs aren't text (a patterned surface past the card's edge)
  pick?: "busiest" | "lowest"; // the corner is the card's last print, so its run is the lowest one with real text
}

// The rows holding text in a strip, found by counting sharp brightness changes along each row: letters make many,
// a frame line or plain art few. Busy runs are joined across small gaps, runs too tall to be text are dropped, and
// the busiest (or, for the corner, the lowest fairly busy) run wins, with a margin. Round 8 (Nov 22, 2026): David's
// picture sheet showed the live outline sitting a little off the card, so fixed name boxes cut the name in half; the
// strips are now cut taller than the card's own edges and trimmed to this. Picking the busiest run took Rabanastre's
// flavor text for its corner, hence "lowest".
export function textBand(gray: ArrayLike<number>, w: number, h: number, opts: BandOptions = {}): [number, number] | null {
  const { mergeGap = 4, maxRows = h, pick = "busiest" } = opts;
  const counts = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 1; x < w; x++) if (Math.abs(gray[y * w + x] - gray[y * w + x - 1]) > 30) n++;
    counts[y] = n;
  }
  const smooth = new Float32Array(h);
  for (let y = 0; y < h; y++) smooth[y] = (counts[Math.max(0, y - 1)] + counts[y] + counts[Math.min(h - 1, y + 1)]) / 3;
  let peak = 0;
  for (const v of smooth) peak = Math.max(peak, v);
  if (peak < w * 0.015) return null;
  const runs: [number, number, number][] = []; // start, end (inclusive), total
  for (let y = 0; y < h; y++) {
    if (smooth[y] < peak * 0.3) continue;
    const last = runs[runs.length - 1];
    if (last && y - last[1] - 1 <= mergeGap) {
      last[1] = y;
      last[2] += smooth[y];
    } else runs.push([y, y, smooth[y]]);
  }
  // A run touching the strip's top or bottom edge is the surface past the card (the strips reach beyond it).
  const text = runs.filter((r) => r[1] - r[0] + 1 <= maxRows && r[0] > 1 && r[1] < h - 2);
  if (!text.length) return null;
  let best = text[0];
  for (const r of text) if (r[2] > best[2]) best = r;
  if (pick === "lowest") {
    const strongest = best[2];
    for (const r of text) if (r[2] >= strongest * 0.2 && r[0] > best[0]) best = r;
  }
  const pad = Math.max(4, Math.round((best[1] - best[0] + 1) * 0.5));
  return [Math.max(0, best[0] - pad), Math.min(h, best[1] + 1 + pad)];
}

// The rows y0..y1 of a strip.
export function cropRows(gray: ArrayLike<number>, w: number, y0: number, y1: number): Uint8Array {
  const out = new Uint8Array(w * (y1 - y0));
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) out[(y - y0) * w + x] = gray[y * w + x];
  return out;
}
