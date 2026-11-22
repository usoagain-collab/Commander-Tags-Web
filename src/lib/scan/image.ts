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
  collector: { x: 0.03, y: 0.905, w: 0.5, h: 0.08 }, // tall enough for both lines even when the edges are found a little off
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

// Find the card's edges in a picture with some background around it. Falls back to the whole picture when no
// card-shaped box stands out (for example, a picture that is already just the card).
export function findCardBounds(p: Pixels): Rect {
  return locateCard(toGray(p), p.width, p.height) ?? { x: 0, y: 0, w: p.width, h: p.height };
}

// A rotated rectangle: centre, size and turn (radians, clockwise in picture coordinates).
export interface Quad {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

// Find a card lying on a fairly plain surface, even tilted (David's photos, Nov 22, 2026: a card in the middle of a
// photo, turned a few degrees, on striped fabric). 1. The surface colour = the median of the picture's outer frame.
// 2. Pixels clearly unlike it belong to something. 3. The biggest connected patch near the middle is the card.
// 4. The tightest rectangle around that patch, trying turns of up to 20° either way, gives its corners.
// `mode` "dark": pixels much darker than the surface, which picks out a black border even when the light on the
// surface is uneven (David's photo: a lighter patch of fabric beside the card joined it in "unlike" mode).
// "unlike": pixels clearly different in colour, for white-bordered or borderless cards.
export function cardOutline(p: Pixels, mode: "dark" | "unlike" = "unlike"): number[] | null {
  const { width: w, height: h, data } = p;
  const frame = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (x >= frame && x < w - frame && y >= frame && y < h - frame) continue;
      const j = (y * w + x) * 4;
      rs.push(data[j]);
      gs.push(data[j + 1]);
      bs.push(data[j + 2]);
    }
  }
  const bg = [median(rs), median(gs), median(bs)];
  const dist = (i: number) => {
    const j = i * 4;
    return Math.hypot(data[j] - bg[0], data[j + 1] - bg[1], data[j + 2] - bg[2]);
  };
  const frameDist: number[] = [];
  for (let k = 0; k < rs.length; k++) frameDist.push(Math.hypot(rs[k] - bg[0], gs[k] - bg[1], bs[k] - bg[2]));
  // Clearly unlike the surface: twice its usual variation, kept between 60 and 110 (striped fabric varies a lot; a black
  // border is about 190 away from a gray surface).
  const threshold = Math.min(110, Math.max(60, median(frameDist) * 2.2));

  const mask = new Uint8Array(w * h);
  if (mode === "dark") {
    const bgLum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
    const darkBelow = Math.min(bgLum * 0.55, bgLum - 50);
    if (darkBelow < 15) return null; // the surface itself is dark; a black border won't stand out
    for (let i = 0; i < mask.length; i++) {
      const j = i * 4;
      mask[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2] < darkBelow ? 1 : 0;
    }
  } else {
    for (let i = 0; i < mask.length; i++) mask[i] = dist(i) > threshold ? 1 : 0;
  }
  // Close one-pixel gaps (foil glare breaks the border). Growing more joined the card to the fabric's dark weave.
  grow(mask, w, h);

  // Connected patches (8 neighbours); keep the biggest, preferring ones that don't touch the picture's edge.
  const label = new Int32Array(w * h);
  const stack: number[] = [];
  let best: { id: number; size: number; edge: boolean } | null = null;
  let id = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    id++;
    let size = 0;
    let edge = false;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (mask[n] && !label[n]) {
            label[n] = id;
            stack.push(n);
          }
        }
      }
    }
    const better = !best || (best.edge && !edge && size > best.size * 0.3) || (best.edge === edge && size > best.size);
    if (better) best = { id, size, edge };
  }
  if (!best || best.size < w * h * 0.04) return null;

  // The patch's outline points (a patch pixel next to a non-patch pixel).
  const pts: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (label[i] !== best.id) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || label[i - 1] !== best.id || label[i + 1] !== best.id || label[i - w] !== best.id || label[i + w] !== best.id) {
        pts.push(x, y);
      }
    }
  }
  return pts;
}

export function locateCardQuad(p: Pixels): Quad | null {
  const pts = cardOutline(p);
  if (!pts) return null;
  let fit: Quad | null = null;
  let fitArea = Infinity;
  for (let deg = -20; deg <= 20; deg += 0.5) {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let k = 0; k < pts.length; k += 2) {
      // Coordinates along the card's own axes when it is turned by `a`.
      const u = pts[k] * cos + pts[k + 1] * sin;
      const v = -pts[k] * sin + pts[k + 1] * cos;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < fitArea) {
      fitArea = area;
      const uc = (u0 + u1) / 2;
      const vc = (v0 + v1) / 2;
      fit = { cx: uc * cos - vc * sin, cy: uc * sin + vc * cos, w: u1 - u0 + 1, h: v1 - v0 + 1, angle: a };
    }
  }
  // Must look like an upright card (63 × 88).
  if (!fit || Math.abs(fit.w / fit.h - CARD_RATIO) > 0.09) return null;
  return fit;
}

// Find the card's four edges as long, nearly straight lines (a restricted "Hough transform"), which works even
// when the edge against the surface isn't one closed outline (David's Worf on striped fabric, Nov 22, 2026).
// For each side, every line within 12° of upright (or level) is scored by how much the brightness changes across it,
// summed along its length. The card's border is a long strong line; fabric weave is weak after a blur. The card's own
// frame has strong lines too, so each side takes the OUTERMOST line that is at least half as strong as the best one
// on that side of the centre. Each side gets its own angle, so a photo taken at an angle (a trapezoid) works.
export function houghCorners(p: Pixels): [Pt, Pt, Pt, Pt] | null {
  const { width: w, height: h } = p;
  let g = toGray(p);
  g = boxBlur(boxBlur(g, w, h, 2), w, h, 2);
  // Signed brightness change to the right (dx) and downward (dy).
  const dx = new Float32Array(w * h);
  const dy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      dx[i] = g[i + 1] - g[i - 1];
      dy[i] = g[i + w] - g[i - w];
    }
  }
  const angles: number[] = [];
  for (let d = -12; d <= 12; d += 0.75) angles.push(Math.tan((d * Math.PI) / 180));

  type Side = "left" | "right" | "top" | "bottom";
  // `signed`: count only "lighter outside, darker inside" (a black border on a lighter surface); fabric stripes
  // change both ways, so they score about half. Otherwise any change counts (white borders, dark surfaces).
  // A side's lines are x = c + (y - h/2)·t (left, right) or y = c + (x - w/2)·t (top, bottom), summed only along
  // `span` (the card's extent the other way, once known), so surface beyond the card doesn't count.
  const findSide = (side: Side, signed: boolean, span: [number, number]): { c: number; t: number } | null => {
    const vertical = side === "left" || side === "right";
    const across = vertical ? w : h;
    const mid = vertical ? h / 2 : w / 2;
    const [from, to] = side === "left" || side === "top" ? [2, Math.floor(across / 2)] : [Math.ceil(across / 2), across - 2];
    const darkerAfter = side === "left" || side === "top"; // inside is further along the axis
    const val = (i: number) => {
      const v = vertical ? dx[i] : dy[i];
      if (!signed) return Math.abs(v);
      return darkerAfter ? Math.max(0, -v) : Math.max(0, v);
    };
    const best = new Float32Array(across);
    const bestT = new Float32Array(across);
    for (const t of angles) {
      const acc = new Float32Array(across);
      for (let s = span[0]; s < span[1]; s++) {
        const shift = (s - mid) * t;
        for (let c = from; c < to; c++) {
          const q = Math.round(c + shift);
          if (q < 0 || q >= across) continue;
          acc[c] += val(vertical ? s * w + q : q * w + s);
        }
      }
      for (let c = from; c < to; c++) {
        if (acc[c] > best[c]) {
          best[c] = acc[c];
          bestT[c] = t;
        }
      }
    }
    let max = 0;
    let sum = 0;
    for (let i = from; i < to; i++) {
      sum += best[i];
      if (best[i] > max) max = best[i];
    }
    if (!(max > (sum / Math.max(1, to - from)) * 2)) return null;
    const inward = darkerAfter ? 1 : -1;
    for (let i = inward === 1 ? from : to - 1; i >= from && i < to; i += inward) {
      if (best[i] < max * 0.5) continue;
      // Just outside the edge, a steep line cutting across the border can pass the bar first; the real edge is the
      // strongest line nearby (it runs along the border its whole length), so take the best within 4%.
      const reach = Math.max(3, Math.round(across * 0.04));
      let at = i;
      for (let j = Math.max(from, i - reach); j < Math.min(to, i + reach + 1); j++) if (best[j] > best[at]) at = j;
      return { c: at, t: bestT[at] };
    }
    return null;
  };

  const vLine = (s: { c: number; t: number }): Line => ({ px: s.c, py: h / 2, dx: s.t, dy: 1 });
  const hLine = (s: { c: number; t: number }): Line => ({ px: w / 2, py: s.c, dx: 1, dy: s.t });
  const solve = (signed: boolean): [Pt, Pt, Pt, Pt] | null => {
    let L = findSide("left", signed, [0, h]);
    let R = findSide("right", signed, [0, h]);
    let T = findSide("top", signed, [0, w]);
    let B = findSide("bottom", signed, [0, w]);
    if (!L || !R || !T || !B) return null;
    // Second pass: top and bottom summed only between the left and right edges, and the sides only between top and
    // bottom (taken at the middle of the picture), so long surface lines beyond the card stop competing.
    const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi, Math.round(v)));
    const xs: [number, number] = [clamp(Math.min(L.c, R.c), w), clamp(Math.max(L.c, R.c), w)];
    const ys: [number, number] = [clamp(Math.min(T.c, B.c), h), clamp(Math.max(T.c, B.c), h)];
    T = findSide("top", signed, xs) ?? T;
    B = findSide("bottom", signed, xs) ?? B;
    L = findSide("left", signed, ys) ?? L;
    R = findSide("right", signed, ys) ?? R;
    const corners = [cross(vLine(L), hLine(T)), cross(vLine(R), hLine(T)), cross(vLine(R), hLine(B)), cross(vLine(L), hLine(B))];
    if (corners.some((c) => !c)) return null;
    const c = corners as [Pt, Pt, Pt, Pt];
    const len = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const width = (len(c[0], c[1]) + len(c[3], c[2])) / 2;
    const height = (len(c[0], c[3]) + len(c[1], c[2])) / 2;
    if (width < w * 0.2 || height < h * 0.2 || Math.abs(width / height - CARD_RATIO) > 0.12) return null;
    return c;
  };
  return solve(true) ?? solve(false);
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / (2 * r + 1);
      s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / (2 * r + 1);
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// Grow the marked area by one pixel in every direction (a 3 × 3 "dilation").
function grow(mask: Uint8Array, w: number, h: number) {
  const src = mask.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x]) continue;
      let hit = 0;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w && src[ny * w + nx]) {
            hit = 1;
            break;
          }
        }
      }
      mask[y * w + x] = hit;
    }
  }
}

export type Pt = [number, number];

// The card's four corners (top-left, top-right, bottom-right, bottom-left), so a photo taken at an angle, where the
// card shows as a trapezoid, can be flattened. The corners are the outline's extreme points along the diagonals,
// which holds for a card turned less than about 30°.
export function cardCorners(p: Pixels): [Pt, Pt, Pt, Pt] | null {
  // A black border first (most cards), then anything unlike the surface.
  for (const mode of ["dark", "unlike"] as const) {
    const pts = cardOutline(p, mode);
    const found = pts ? cornersOf(pts) : null;
    if (found) return found;
  }
  return null;
}

function cornersOf(pts: number[]): [Pt, Pt, Pt, Pt] | null {
  let tl = 0;
  let tr = 0;
  let br = 0;
  let bl = 0;
  for (let k = 0; k < pts.length; k += 2) {
    const s = pts[k] + pts[k + 1];
    const d = pts[k] - pts[k + 1];
    if (s < pts[tl] + pts[tl + 1]) tl = k;
    if (s > pts[br] + pts[br + 1]) br = k;
    if (d > pts[tr] - pts[tr + 1]) tr = k;
    if (d < pts[bl] - pts[bl + 1]) bl = k;
  }
  const c: [Pt, Pt, Pt, Pt] = [
    [pts[tl], pts[tl + 1]],
    [pts[tr], pts[tr + 1]],
    [pts[br], pts[br + 1]],
    [pts[bl], pts[bl + 1]],
  ];
  const len = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const width = (len(c[0], c[1]) + len(c[3], c[2])) / 2;
  const height = (len(c[0], c[3]) + len(c[1], c[2])) / 2;
  // Must look like an upright card, allowing for some slant.
  if (!height || Math.abs(width / height - CARD_RATIO) > 0.12) return null;
  // Rounded or shadowed corners put the extreme points inside the real corners (David's photo lost its border and
  // corner print that way), so fit a straight line along each edge and use where the lines cross.
  return refineCorners(pts, c, width) ?? c;
}

type Line = { px: number; py: number; dx: number; dy: number }; // a point on the line and its direction

// The straight line through points (direction of greatest spread), dropping the points furthest off it once.
function fitLine(xs: number[], ys: number[]): Line | null {
  const fit = (ix: number[]): Line | null => {
    if (ix.length < 8) return null;
    let mx = 0;
    let my = 0;
    for (const i of ix) {
      mx += xs[i];
      my += ys[i];
    }
    mx /= ix.length;
    my /= ix.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const i of ix) {
      const dx = xs[i] - mx;
      const dy = ys[i] - my;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { px: mx, py: my, dx: Math.cos(a), dy: Math.sin(a) };
  };
  const all = xs.map((_, i) => i);
  const first = fit(all);
  if (!first) return null;
  const off = all.map((i) => Math.abs((xs[i] - first.px) * first.dy - (ys[i] - first.py) * first.dx));
  const cut = [...off].sort((a, b) => a - b)[Math.floor(off.length * 0.8)];
  return fit(all.filter((i) => off[i] <= cut)) ?? first;
}

function cross(a: Line, b: Line): Pt | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return [a.px + t * a.dx, a.py + t * a.dy];
}

export function refineCorners(pts: number[], c: [Pt, Pt, Pt, Pt], width: number): [Pt, Pt, Pt, Pt] | null {
  const near = width * 0.06; // how far from the rough edge a point may be and still count
  const lines: Line[] = [];
  for (let side = 0; side < 4; side++) {
    const [ax, ay] = c[side];
    const [bx, by] = c[(side + 1) % 4];
    const len = Math.hypot(bx - ax, by - ay);
    // The outline also traces shapes inside the card (name bar, text box), so keep only the OUTERMOST point in each
    // of 60 slices along the edge. Corners run clockwise, so "outward" is to the left of the edge's direction.
    const BINS = 60;
    const bestOut = new Float64Array(BINS).fill(-Infinity);
    const bestX = new Float64Array(BINS);
    const bestY = new Float64Array(BINS);
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k];
      const y = pts[k + 1];
      const t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len);
      if (t < 0.12 || t > 0.88) continue; // stay clear of the rounded corners
      const out = -((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / len;
      if (Math.abs(out) > near) continue;
      const bin = Math.min(BINS - 1, Math.floor(t * BINS));
      if (out > bestOut[bin]) {
        bestOut[bin] = out;
        bestX[bin] = x;
        bestY[bin] = y;
      }
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (let b = 0; b < BINS; b++) {
      if (bestOut[b] > -Infinity) {
        xs.push(bestX[b]);
        ys.push(bestY[b]);
      }
    }
    const line = fitLine(xs, ys);
    if (!line) return null;
    lines.push(line);
  }
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    // Corner i sits where the edge before it (i - 1) meets the edge after it (i).
    const p = cross(lines[(i + 3) % 4], lines[i]);
    if (!p || Math.hypot(p[0] - c[i][0], p[1] - c[i][1]) > width * 0.15) return null;
    out.push(p);
  }
  return out as [Pt, Pt, Pt, Pt];
}

// The 3 × 3 perspective map taking the corners of a w × h rectangle to the four points `to` (TL, TR, BR, BL).
export function homography(w: number, h: number, to: [Pt, Pt, Pt, Pt]): number[] {
  const from: Pt[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gauss-Jordan elimination on the 8 × 9 system.
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let k = col; k < 9; k++) A[r][k] -= f * A[col][k];
    }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
}

// Flatten: each pixel of the w × h output is looked up in `src` through the map (bilinear blend of 4 pixels).
export function warp(src: Pixels, H: number[], w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const sw = src.width;
  const sh = src.height;
  const d = src.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const z = H[6] * x + H[7] * y + H[8];
      const u = (H[0] * x + H[1] * y + H[2]) / z;
      const v = (H[3] * x + H[4] * y + H[5]) / z;
      const o = (y * w + x) * 4;
      out[o + 3] = 255;
      if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) continue;
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = u - x0;
      const fy = v - y0;
      for (let ch = 0; ch < 3; ch++) {
        const a = d[(y0 * sw + x0) * 4 + ch];
        const b = d[(y0 * sw + x1) * 4 + ch];
        const c = d[(y1 * sw + x0) * 4 + ch];
        const e = d[(y1 * sw + x1) * 4 + ch];
        out[o + ch] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
      }
    }
  }
  return out;
}

// Sum of |brightness change| per column (across rows y0..y1) or per row (across columns x0..x1), smoothed a little so
// a slightly tilted edge, spread over a few pixels, still stands out.
function edgeProfile(g: Float32Array, w: number, h: number, dir: "col" | "row", a0: number, a1: number): Float32Array {
  const len = dir === "col" ? w : h;
  const raw = new Float32Array(len);
  if (dir === "col") {
    for (let y = a0; y < a1; y++) for (let x = 1; x < w; x++) raw[x] += Math.abs(g[y * w + x] - g[y * w + x - 1]);
  } else {
    for (let x = a0; x < a1; x++) for (let y = 1; y < h; y++) raw[y] += Math.abs(g[y * w + x] - g[(y - 1) * w + x]);
  }
  const k = Math.max(1, Math.round(len * 0.006));
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(len - 1, i + k); j++) s += raw[j];
    out[i] = s;
  }
  return out;
}

// The outermost strong edge between `from` and `to`, scanning inward. The card's own frame has strong edges too
// (border to name bar), so the first big change met from outside is the card's edge; weaker texture (fabric, wood
// grain) stays under the bar. Null when nothing stands out.
function outermostEdge(p: Float32Array, from: number, to: number, inward: 1 | -1): number | null {
  let best = 0;
  let sum = 0;
  for (let i = from; i < to; i++) {
    sum += p[i];
    if (p[i] > best) best = p[i];
  }
  const mean = sum / Math.max(1, to - from);
  if (!(best > mean * 2.5)) return null;
  const bar = best * 0.55;
  for (let i = inward === 1 ? from : to - 1; i >= from && i < to; i += inward) {
    if (p[i] < bar) continue;
    // Smoothing widened the edge; step on to its peak, which is where the edge really is.
    const inside = (j: number) => j >= from && j < to;
    while (inside(i + inward) && p[i + inward] > p[i]) i += inward;
    let j = i;
    while (inside(j + inward) && p[j + inward] === p[i]) j += inward; // a flat top: take its middle
    return Math.round((i + j) / 2);
  }
  return null;
}

// Find the card anywhere in the picture (it may fill only the middle of a photo): look across the middle band for
// the outermost strong edge on each side, then look again using only the rows and columns inside that first box.
export function locateCard(g: Float32Array, w: number, h: number): Rect | null {
  let box = { x0: Math.floor(w * 0.2), x1: Math.ceil(w * 0.8), y0: Math.floor(h * 0.2), y1: Math.ceil(h * 0.8) };
  let rect: Rect | null = null;
  for (let pass = 0; pass < 2; pass++) {
    const cols = edgeProfile(g, w, h, "col", box.y0, box.y1);
    const rows = edgeProfile(g, w, h, "row", box.x0, box.x1);
    const cx = Math.round((box.x0 + box.x1) / 2);
    const cy = Math.round((box.y0 + box.y1) / 2);
    const left = outermostEdge(cols, 1, cx, 1);
    const right = outermostEdge(cols, cx, w, -1);
    const top = outermostEdge(rows, 1, cy, 1);
    const bottom = outermostEdge(rows, cy, h, -1);
    if (left === null || right === null || top === null || bottom === null) return rect;
    const next = { x: left, y: top, w: right - left, h: bottom - top };
    // A card is 63 × 88; anything far from that means an edge was found in the art or the background.
    if (next.w < w * 0.2 || next.h < h * 0.2 || Math.abs(next.w / next.h - CARD_RATIO) > 0.1) return rect;
    rect = next;
    const mx = Math.round(next.w * 0.15);
    const my = Math.round(next.h * 0.15);
    box = { x0: next.x + mx, x1: next.x + next.w - mx, y0: next.y + my, y1: next.y + next.h - my };
  }
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
