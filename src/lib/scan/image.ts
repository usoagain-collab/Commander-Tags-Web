// Card scanner experiment (Nov 21, 2026): plain-array image helpers, so they run in tests without a browser.
// Pixels come as RGBA bytes (what a canvas gives), width × height.

export interface Pixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// A card is 63 × 88 mm.
export const CARD_RATIO = 63 / 88;

// Parts of an upright card, as fractions of its width and height (measured on Scryfall's large images).
export const REGIONS = {
  name: { x: 0.06, y: 0.035, w: 0.66, h: 0.06 },
  collector: { x: 0.03, y: 0.925, w: 0.46, h: 0.06 },
  art: { x: 0.09, y: 0.12, w: 0.82, h: 0.44 },
} satisfies Record<string, Rect>;

export function toGray(p: Pixels): Float32Array {
  const out = new Float32Array(p.width * p.height);
  for (let i = 0; i < out.length; i++) {
    const j = i * 4;
    out[i] = 0.299 * p.data[j] + 0.587 * p.data[j + 1] + 0.114 * p.data[j + 2];
  }
  return out;
}

// Average of each cell when the area `r` (in pixels) is split into cols × rows; one value per channel picked by `pick`.
function cellMeans(p: Pixels, r: Rect, cols: number, rows: number, pick: (j: number) => number): Float32Array {
  const out = new Float32Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor(r.y + (cy * r.h) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(r.y + ((cy + 1) * r.h) / rows));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor(r.x + (cx * r.w) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(r.x + ((cx + 1) * r.w) / cols));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < p.height; y++) {
        for (let x = x0; x < x1 && x < p.width; x++) {
          sum += pick((y * p.width + x) * 4);
          n++;
        }
      }
      out[cy * cols + cx] = n ? sum / n : 0;
    }
  }
  return out;
}

export function scaleRect(r: Rect, width: number, height: number): Rect {
  return { x: r.x * width, y: r.y * height, w: r.w * width, h: r.h * height };
}

// Difference hash: shrink to (size+1) × size gray cells, one bit per "is the next cell to the right brighter".
// Small changes in light, blur and size barely change it; different pictures differ in about half the bits.
export function dHash(p: Pixels, r: Rect = { x: 0, y: 0, w: p.width, h: p.height }, size = 16): Uint8Array {
  const gray = (j: number) => 0.299 * p.data[j] + 0.587 * p.data[j + 1] + 0.114 * p.data[j + 2];
  const cells = cellMeans(p, r, size + 1, size, gray);
  const bits = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) bits[y * size + x] = cells[y * (size + 1) + x + 1] > cells[y * (size + 1) + x] ? 1 : 0;
  }
  return bits;
}

export function hamming(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

// Color layout: average red, green and blue in a 4 × 4 grid, each channel scaled so overall brightness doesn't count.
export function colorGrid(p: Pixels, r: Rect = { x: 0, y: 0, w: p.width, h: p.height }, n = 4): Float32Array {
  const parts = [0, 1, 2].map((c) => cellMeans(p, r, n, n, (j) => p.data[j + c]));
  const out = new Float32Array(n * n * 3);
  for (let c = 0; c < 3; c++) {
    let mean = 0;
    for (const v of parts[c]) mean += v;
    mean = mean / parts[c].length || 1;
    for (let i = 0; i < n * n; i++) out[c * n * n + i] = parts[c][i] / mean;
  }
  return out;
}

export function colorDistance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

// One number per candidate, lower = more alike: hash difference (0..1) plus a little color difference.
export function matchScore(hashDiff: number, bits: number, colorDiff: number): number {
  return hashDiff / bits + 0.5 * colorDiff;
}

// Inside a rough crop that has some background around the card, find the card's edges: the column (and row)
// in each outer quarter where brightness changes most sharply. Falls back to the whole crop when no edge stands out.
export function findCardBounds(p: Pixels): Rect {
  const g = toGray(p);
  const { width: w, height: h } = p;
  const col = new Float32Array(w);
  const row = new Float32Array(h);
  for (let y = Math.floor(h * 0.2); y < h * 0.8; y++) {
    for (let x = 1; x < w; x++) col[x] += Math.abs(g[y * w + x] - g[y * w + x - 1]);
  }
  for (let x = Math.floor(w * 0.2); x < w * 0.8; x++) {
    for (let y = 1; y < h; y++) row[y] += Math.abs(g[y * w + x] - g[(y - 1) * w + x]);
  }
  // The card's own frame has strong edges too (border to name bar), so take the OUTERMOST strong edge, scanning
  // in from the crop's side: background to card border is the first big change.
  const edge = (profile: Float32Array, from: number, to: number, inward: 1 | -1): number | null => {
    let best = 0;
    let sum = 0;
    for (let i = from; i < to; i++) {
      sum += profile[i];
      best = Math.max(best, profile[i]);
    }
    const mean = sum / Math.max(1, to - from);
    if (!(best > mean * 3)) return null;
    const start = inward === 1 ? from : to - 1;
    for (let i = start; i >= from && i < to; i += inward) if (profile[i] >= best * 0.5) return i;
    return null;
  };
  const left = edge(col, 1, Math.floor(w * 0.25), 1) ?? 0;
  const right = edge(col, Math.ceil(w * 0.75), w, -1) ?? w;
  const top = edge(row, 1, Math.floor(h * 0.25), 1) ?? 0;
  const bottom = edge(row, Math.ceil(h * 0.75), h, -1) ?? h;
  const rect = { x: left, y: top, w: right - left, h: bottom - top };
  // A result far from a card's shape means an edge was found in the art instead; keep the crop as it was.
  const ratio = rect.w / rect.h;
  if (rect.w < w * 0.5 || rect.h < h * 0.5 || Math.abs(ratio - CARD_RATIO) > 0.08) return { x: 0, y: 0, w, h };
  return rect;
}

// Otsu's threshold: the gray level that best splits text from background. Used to make OCR crops black on white.
export function otsu(gray: Float32Array): number {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let level = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      level = t;
    }
  }
  return level;
}
