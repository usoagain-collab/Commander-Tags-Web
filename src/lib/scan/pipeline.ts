// Card scanner experiment (Nov 21, 2026): the browser side of one test scan.
// 1. Straighten the crop into a flat 630 × 880 card.  2. Read the name and the collector line with Tesseract (free OCR,
// runs on the phone).  3. Look both up on Scryfall.  4. Compare the picture with every printing of the card.
// Everything here runs in the browser; the photo never leaves the phone.

import { parseCollectorLine, type CollectorLine } from "./collector-line";
import { buildNameIndex, cleanNameRead, closestName, nameFits, printedNames, setCodeVariants, type NameIndex } from "./names";
import { CARD_RATIO, cardCorners, colorDistance, colorGrid, dHash, findCardBounds, homography, houghCorners, locateCardQuad, type Pt, type Quad, warp, hamming, matchScore, otsu, REGIONS, scaleRect, toGray, type Pixels, type Rect } from "./image";

const API = "https://api.scryfall.com";
// The straightened card keeps the photo's own resolution (630 to 1400 px wide), so the tiny corner text isn't shrunk away.
const MIN_W = 630;
const MAX_W = 1400;
const HASH = 16;

export interface Printing {
  id: string;
  oracleId: string;
  name: string;
  set: string;
  setName: string;
  number: string;
  lang: string;
  image: string; // small image
  finishes: string[];
  flavorName?: string; // a Universes Beyond name printed on the card ("Worf, Regent of Terok Nor" on Mogis)
}

export interface Ranked extends Printing {
  cardScore: number;
  artScore: number;
}

export interface PhotoPrints {
  card: Uint8Array;
  art: Uint8Array;
  cardColor: Float32Array;
  artColor: Float32Array;
}

export interface ScanOutput {
  cardImage: string; // the straightened card, as a data URL
  nameImage: string; // what OCR saw for the name
  lineImage: string; // what OCR saw for the collector line
  nameRead: string;
  nameMatch: Printing | null;
  nameVia: "scryfall" | "closest" | null; // Scryfall's fuzzy search, or the closest name in the full list
  lineRead: string;
  line: CollectorLine;
  linePrinting: Printing | null;
  lineFixedFrom: string | null; // what the corner said, when it was corrected (a lookalike set code, or the named card's printings)
  disagree: boolean; // the name and the corner point at different cards
  prints: PhotoPrints;
  candidates: Ranked[]; // sorted by whole-card score, best first
  artOrder: string[]; // printing keys sorted by art score
  timing: Record<string, number>; // ms per step (name and corner overlap)
  ms: number;
}

export const printingKey = (p: { set: string; number: string }) => `${p.set}/${p.number}`;

/* ---------- canvas helpers ---------- */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't draw images.");
  return [c, ctx];
}

const pixelsOf = (ctx: CanvasRenderingContext2D, w: number, h: number): Pixels => ctx.getImageData(0, 0, w, h);

// How the card's edges were found at capture (shown in the review and saved with each scan).
export type FoundBy = "edges" | "outline" | "live" | "turned" | "box" | "whole";

export interface Straightened {
  card: HTMLCanvasElement;
  foundBy: FoundBy;
}

// Cut `rect` out of the source, find the card inside it (on a smaller copy, for speed) and flatten it upright.
// First choice: the card's four edges as straight lines (houghCorners), then its outline's corners (both fix tilt
// and a photo taken at an angle, where the card is a trapezoid). `live`: the corners the gold outline showed at the
// tap, in source pixels; used when neither finds the card here, or when what they found is much smaller than the
// outline (an inner line, like the art's edge, taken for the card's). Then a turned rectangle; then plain edge
// finding; else the whole crop.
export async function straighten(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  rect: Rect | null,
  refine: boolean,
  live: [Pt, Pt, Pt, Pt] | null = null,
): Promise<Straightened> {
  const r = rect ?? { x: 0, y: 0, w: srcW, h: srcH };
  let quad: Quad = { cx: r.w / 2, cy: r.h / 2, w: r.w, h: r.h, angle: 0 };
  let foundBy: FoundBy = "whole";
  if (refine) {
    // 500 px is plenty to place the edges (the flatten itself uses the full photo); round 5 used 600 at finer angles.
    const s = Math.min(1, 500 / Math.max(r.w, r.h));
    const [sc, sctx] = canvas(r.w * s, r.h * s);
    sctx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, sc.width, sc.height);
    const small = pixelsOf(sctx, sc.width, sc.height);
    const hough = houghCorners(small, 1);
    const found = hough ?? cardCorners(small);
    const inCrop = live ? (live.map(([x, y]) => [x - r.x, y - r.y]) as [Pt, Pt, Pt, Pt]) : null;
    const area = (q: Pt[]) => Math.abs(q.reduce((t, [x, y], i) => t + x * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * y, 0)) / 2;
    if (found) {
      const corners = found.map(([x, y]) => [x / s, y / s]) as [Pt, Pt, Pt, Pt];
      if (!inCrop || area(corners) > area(inCrop) * 0.7) return { card: flatten(source, r, corners), foundBy: hough ? "edges" : "outline" };
    }
    if (inCrop) return { card: flatten(source, r, inCrop), foundBy: "live" };
    const q = locateCardQuad(small);
    if (q) {
      quad = { cx: q.cx / s, cy: q.cy / s, w: q.w / s, h: q.h / s, angle: q.angle };
      foundBy = "turned";
    } else {
      const b = findCardBounds(small);
      quad = { cx: (b.x + b.w / 2) / s, cy: (b.y + b.h / 2) / s, w: b.w / s, h: b.h / s, angle: 0 };
      foundBy = "box";
    }
  }
  const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, quad.w)));
  const h = Math.round(w / CARD_RATIO);
  const [c, ctx] = canvas(w, h);
  ctx.imageSmoothingQuality = "high";
  // Map the turned card onto the upright canvas: centre it, scale it, undo its turn.
  ctx.translate(w / 2, h / 2);
  ctx.scale(w / quad.w, h / quad.h);
  ctx.rotate(-quad.angle);
  ctx.drawImage(source, r.x, r.y, r.w, r.h, -quad.cx, -quad.cy, r.w, r.h);
  return { card: c, foundBy };
}

// Perspective-correct the card from its four corners (in crop pixels) onto an upright canvas.
function flatten(source: CanvasImageSource, r: Rect, corners: [Pt, Pt, Pt, Pt]): HTMLCanvasElement {
  // Work on a copy at most 2400 px on its long side: plenty for the corner print, and light enough for a phone.
  const k = Math.min(1, 2400 / Math.max(r.w, r.h));
  const [, wctx] = canvas(r.w * k, r.h * k);
  wctx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, wctx.canvas.width, wctx.canvas.height);
  const src = pixelsOf(wctx, wctx.canvas.width, wctx.canvas.height);
  const scaled = corners.map(([x, y]) => [x * k, y * k]) as [Pt, Pt, Pt, Pt];
  const len = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const across = Math.max(len(scaled[0], scaled[1]), len(scaled[3], scaled[2]));
  const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, across)));
  const h = Math.round(w / CARD_RATIO);
  const [c, ctx] = canvas(w, h);
  const img = ctx.createImageData(w, h);
  img.data.set(warp(src, homography(w, h, scaled), w, h));
  ctx.putImageData(img, 0, 0);
  return c;
}

// A region of the card, enlarged to `width` pixels. Gray, or black text on white when `binary` (Otsu's threshold);
// which reads better is part of what the experiment measures, so the corner is read both ways.
function ocrCrop(card: HTMLCanvasElement, region: Rect, width: number, binary: boolean): HTMLCanvasElement {
  const r = scaleRect(region, card.width, card.height);
  const [c, ctx] = canvas(width, (width * r.h) / r.w);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(card, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const gray = toGray(img);
  const t = otsu(gray);
  let dark = 0;
  for (const v of gray) if (v <= t) dark++;
  const invert = dark > gray.length / 2; // light text on a dark border
  for (let i = 0; i < gray.length; i++) {
    let v = invert ? 255 - gray[i] : gray[i];
    if (binary) v = (invert ? gray[i] > t : gray[i] <= t) ? 0 : 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ---------- OCR ---------- */

type TessWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
type Mode = "name" | "corner";
const workers: Partial<Record<Mode, Promise<TessWorker>>> = {};

// The characters each read may produce. A card name has no digits (the reader turned "U.S.S." into "11S S"); the
// corner is capitals, digits and a few marks (lower case let "SDS" come out "sDS").
const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ,.'-:!&";
const CORNER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/•★*. ";

// One reader for the name and one for the corner, so both read at the same time (round 6: scans were slow, and
// phones have several cores). Loaded on first use: about 10 MB the first time (Tesseract's engine and English data,
// from the jsDelivr CDN), cached after; the second reader loads from that cache. Settings are set once per reader.
function worker(mode: Mode): Promise<TessWorker> {
  let w = workers[mode];
  if (!w) {
    w = import("tesseract.js").then(async ({ createWorker }) => {
      const tw = await createWorker("eng");
      // Page segmentation modes: 7 = one line of text (the name), 6 = one block (the corner's two lines).
      await tw.setParameters({
        tessedit_pageseg_mode: (mode === "name" ? "7" : "6") as never,
        tessedit_char_whitelist: mode === "name" ? NAME_CHARS : CORNER_CHARS,
      });
      return tw;
    });
    workers[mode] = w;
    w.catch(() => delete workers[mode]);
  }
  return w;
}

export function ocrWorker(): Promise<unknown> {
  return Promise.all([worker("name"), worker("corner")]);
}

async function readText(image: HTMLCanvasElement, mode: Mode): Promise<string> {
  const { data } = await (await worker(mode)).recognize(image);
  return data.text.trim();
}

/* ---------- Scryfall ---------- */

interface ScryCard {
  id: string;
  oracle_id?: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  lang: string;
  finishes?: string[];
  flavor_name?: string;
  image_uris?: { small?: string };
  card_faces?: { oracle_id?: string; image_uris?: { small?: string } }[];
}

function toPrinting(c: ScryCard): Printing {
  return {
    id: c.id,
    oracleId: c.oracle_id ?? c.card_faces?.[0]?.oracle_id ?? "",
    name: c.name,
    set: c.set,
    setName: c.set_name,
    number: c.collector_number,
    lang: c.lang,
    image: c.image_uris?.small ?? c.card_faces?.[0]?.image_uris?.small ?? "",
    finishes: c.finishes ?? [],
    flavorName: c.flavor_name,
  };
}

// Cards whose name (or printed flavor name) contains the typed words, most played first, up to 15. Used when a name
// fits too many cards for the fuzzy lookup ("Worf").
export async function searchCards(text: string): Promise<Printing[]> {
  const words = text.replace(/["()]/g, " ").trim();
  if (words.length < 2) return [];
  const res = await scry<{ data: ScryCard[] }>(
    `/cards/search?${new URLSearchParams({ q: `"${words}" game:paper`, unique: "prints", include_extras: "true", order: "edhrec" })}`,
  );
  const seen = new Set<string>();
  const out: Printing[] = [];
  for (const c of res?.data ?? []) {
    const p = toPrinting(c);
    // One tile per name as printed (the Worf printing of Mogis is its own tile next to plain Mogis).
    const key = `${p.oracleId}|${p.flavorName ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= 15) break;
  }
  return out;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Scryfall asks for 10 requests a second at most. Calls queue through one gate that waits only when the previous call
// started under 100 ms ago (round 5 paused 100 ms before every call, even after a long OCR read).
let gate: Promise<void> = Promise.resolve();
let lastCall = 0;
function turn(): Promise<void> {
  const mine = gate.then(async () => {
    const wait = lastCall + 100 - performance.now();
    if (wait > 0) await pause(wait);
    lastCall = performance.now();
  });
  gate = mine;
  return mine;
}

async function scry<T>(path: string): Promise<T | null> {
  await turn();
  const res = await fetch(`${API}${path}`, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Scryfall answered ${res.status}`);
  return (await res.json()) as T;
}

// Scryfall's fuzzy search (it also knows flavor names like "Worf, Regent of Terok Nor"). When it finds nothing, try
// again without the last word, up to twice: one misread letter at the end ("Nox" for "Nor") is enough to fail it.
export async function cardByName(text: string): Promise<Printing | null> {
  let words = cleanNameRead(text).split(" ");
  for (let tries = 0; tries < 3 && words.join(" ").length >= 3; tries++) {
    const c = await scry<ScryCard>(`/cards/named?${new URLSearchParams({ fuzzy: words.join(" ") })}`);
    if (c) return toPrinting(c);
    if (words.length <= 2) break;
    words = words.slice(0, -1);
  }
  return null;
}

export async function cardByExactName(name: string): Promise<Printing | null> {
  const c = await scry<ScryCard>(`/cards/named?${new URLSearchParams({ exact: name })}`);
  return c ? toPrinting(c) : null;
}

let namesPromise: Promise<NameIndex> | null = null;

// Printed flavor names and the real card each belongs to (about 1,000 printings, a few pages of search).
async function flavorNames(): Promise<[string, string][]> {
  const out = new Map<string, string>();
  let path: string | null = `/cards/search?${new URLSearchParams({ q: "has:flavorname game:paper", unique: "prints", include_extras: "true" })}`;
  for (let page = 0; path && page < 12; page++) {
    const res: { data: ScryCard[]; next_page?: string } | null = await scry(path);
    if (!res) break;
    for (const c of res.data) if (c.flavor_name) out.set(c.flavor_name, c.name);
    path = res.next_page ? res.next_page.replace(API, "") : null;
  }
  return [...out];
}

// Scryfall's list of every card name (about 700 KB) plus printed flavor names, fetched once per visit.
export function nameIndex(): Promise<NameIndex> {
  namesPromise ??= Promise.all([scry<{ data: string[] }>("/catalog/card-names"), flavorNames().catch(() => [] as [string, string][])]).then(
    ([names, flavors]) => {
      if (!names) throw new Error("No card name list");
      return buildNameIndex(names.data, flavors);
    },
  );
  namesPromise.catch(() => (namesPromise = null));
  return namesPromise;
}

let setsPromise: Promise<Set<string>> | null = null;

// Every set code Scryfall knows (about 1,100), to tell a misread code from a real one. Kept a day on this device.
export function setCodes(): Promise<Set<string>> {
  setsPromise ??= (async () => {
    try {
      const saved = JSON.parse(localStorage.getItem("scan-lab:sets") ?? "null") as { at: number; codes: string[] } | null;
      if (saved && Date.now() - saved.at < 86_400_000 && saved.codes.length > 500) return new Set(saved.codes);
    } catch {
      // read it fresh
    }
    const res = await scry<{ data: { code: string }[] }>("/sets");
    const codes = (res?.data ?? []).map((s) => s.code.toLowerCase());
    if (!codes.length) throw new Error("No set list");
    localStorage.setItem("scan-lab:sets", JSON.stringify({ at: Date.now(), codes }));
    return new Set(codes);
  })();
  setsPromise.catch(() => (setsPromise = null));
  return setsPromise;
}

export interface LineLookup {
  printing: Printing | null;
  fixedFrom: string | null; // the set code as read, when a lookalike code fit better ("sos" read, "sds" used)
}

// The printing the corner names. The set code may be misread (SDS as SOS, TRK as TREK), so every real code one slip
// away is tried; when the name was read, the printing of that card wins, otherwise the one whose picture is most like
// the photo. A misread code that happens to be real ("sos") would point at another card, which the picture gives away.
async function cardByLine(line: CollectorLine, photo: PhotoPrints, nameMatch: Printing | null): Promise<LineLookup> {
  const none = { printing: null, fixedFrom: null };
  if (!line.set || !line.number) return none;
  const valid = await setCodes().catch(() => null);
  const codes = valid ? setCodeVariants(line.set, valid) : [line.set];
  const found: Printing[] = [];
  for (const code of codes) {
    const base = `/cards/${encodeURIComponent(code)}/${encodeURIComponent(line.number)}`;
    const c = (line.lang && line.lang !== "en" ? await scry<ScryCard>(`${base}/${line.lang}`).catch(() => null) : null) ?? (await scry<ScryCard>(base).catch(() => null));
    if (!c) continue;
    found.push(toPrinting(c));
    // The named card's printing: no need to try the other codes (round 5 always tried all of them, up to 12 calls).
    if (nameMatch && found[found.length - 1].oracleId === nameMatch.oracleId) break;
  }
  if (!found.length) return none;
  const named = nameMatch ? found.find((p) => p.oracleId === nameMatch.oracleId) : undefined;
  let pick = named ?? found[0];
  if (!named && found.length > 1) {
    let bestScore = Infinity;
    for (const p of found) {
      const q = p.image ? await printsOfUrl(p.image) : null;
      if (!q) continue;
      const s = matchScore(hamming(photo.card, q.card), HASH * HASH, colorDistance(photo.cardColor, q.cardColor));
      if (s < bestScore) {
        bestScore = s;
        pick = p;
      }
    }
  }
  return { printing: pick, fixedFrom: pick.set !== line.set ? line.set : null };
}

// Every English paper printing of the card, promos and variants included (up to 525).
export async function printingsOf(oracleId: string): Promise<Printing[]> {
  const out: Printing[] = [];
  let path: string | null = `/cards/search?${new URLSearchParams({ q: `oracleid:${oracleId} game:paper`, unique: "prints", include_extras: "true", include_variations: "true", order: "released" })}`;
  for (let page = 0; path && page < 3; page++) {
    const res: { data: ScryCard[]; next_page?: string } | null = await scry(path);
    if (!res) break;
    out.push(...res.data.map(toPrinting));
    path = res.next_page ? res.next_page.replace(API, "") : null;
  }
  return out;
}

/* ---------- picture matching ---------- */

// Skip the outer 3% (rounded corners, background) on both the photo and Scryfall's image.
const INSET: Rect = { x: 0.03, y: 0.02, w: 0.94, h: 0.96 };

function printsOf(p: Pixels): PhotoPrints {
  const whole = scaleRect(INSET, p.width, p.height);
  const art = scaleRect(REGIONS.art, p.width, p.height);
  return { card: dHash(p, whole, HASH), art: dHash(p, art, HASH), cardColor: colorGrid(p, whole), artColor: colorGrid(p, art) };
}

export function photoPrints(card: HTMLCanvasElement): PhotoPrints {
  const ctx = card.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't draw images.");
  return printsOf(pixelsOf(ctx, card.width, card.height));
}

const imageCache = new Map<string, Promise<PhotoPrints | null>>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // Scryfall's image servers allow it, so the canvas can read the pixels
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${src}`));
    img.src = src;
  });
}

function printsOfUrl(src: string): Promise<PhotoPrints | null> {
  let hit = imageCache.get(src);
  if (!hit) {
    hit = loadImage(src)
      .then((img) => {
        const [, ctx] = canvas(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, 0, 0);
        return printsOf(pixelsOf(ctx, img.naturalWidth, img.naturalHeight));
      })
      .catch(() => null);
    imageCache.set(src, hit);
  }
  return hit;
}

export async function rank(photo: PhotoPrints, printings: Printing[]): Promise<{ candidates: Ranked[]; artOrder: string[] }> {
  const ranked: Ranked[] = [];
  for (let i = 0; i < printings.length; i += 16) {
    const batch = printings.slice(i, i + 16);
    const prints = await Promise.all(batch.map((p) => (p.image ? printsOfUrl(p.image) : Promise.resolve(null))));
    batch.forEach((p, j) => {
      const q = prints[j];
      if (!q) return;
      ranked.push({
        ...p,
        cardScore: matchScore(hamming(photo.card, q.card), HASH * HASH, colorDistance(photo.cardColor, q.cardColor)),
        artScore: matchScore(hamming(photo.art, q.art), HASH * HASH, colorDistance(photo.artColor, q.artColor)),
      });
    });
  }
  const artOrder = [...ranked].sort((a, b) => a.artScore - b.artScore).map(printingKey);
  return { candidates: ranked.sort((a, b) => a.cardScore - b.cardScore), artOrder };
}

/* ---------- one scan ---------- */

// The value of a promise that has already settled, else null (don't hold a scan up for a list still loading).
function ifReady<T>(p: Promise<T>): Promise<T | null> {
  return Promise.race([p.catch(() => null), Promise.resolve(null)]);
}

interface NameResult {
  nameRead: string;
  nameMatch: Printing | null;
  nameVia: ScanOutput["nameVia"];
  nameCrop: HTMLCanvasElement;
}

// The name, from each crop in turn until one names a card: first the closest name in the full list (no fuzzy search
// when the read is close), then Scryfall's fuzzy search, kept only if the read really looks like the card it
// returned. If none works, the closest name allowing more mistakes.
async function readName(crops: HTMLCanvasElement[], index: NameIndex | null): Promise<NameResult> {
  const reads: { text: string; crop: HTMLCanvasElement }[] = [];
  for (const crop of crops) {
    const text = await readText(crop, "name");
    reads.push({ text, crop });
    const near = index ? closestName(text, index, 0.25) : null;
    if (near) {
      const match = await cardByExactName(near.target).catch(() => null);
      if (match) return { nameRead: text, nameMatch: match, nameVia: "closest", nameCrop: crop };
    }
    const match = await cardByName(text).catch(() => null);
    if (match && (!index || nameFits(text, [...printedNames(match.name, index), match.flavorName ?? ""]))) {
      return { nameRead: text, nameMatch: match, nameVia: "scryfall", nameCrop: crop };
    }
  }
  if (index) {
    const guesses = reads.map((r) => ({ ...r, guess: closestName(r.text, index) })).filter((r) => r.guess);
    guesses.sort((a, b) => a.guess!.share - b.guess!.share);
    const best = guesses[0];
    if (best?.guess) {
      const match = await cardByExactName(best.guess.target).catch(() => null);
      if (match) return { nameRead: best.text, nameMatch: match, nameVia: "closest", nameCrop: best.crop };
    }
  }
  return { nameRead: reads.find((r) => r.text)?.text ?? "", nameMatch: null, nameVia: null, nameCrop: crops[0] };
}

// The corner: until a read gives a number and a set code that is real or one slip from a real one.
async function readCorner(crops: HTMLCanvasElement[], validSets: Set<string> | null) {
  const usable = (l: CollectorLine) => !!(l.set && l.number && (!validSets || setCodeVariants(l.set, validSets).length));
  let lineRead = "";
  let line = parseCollectorLine("");
  let lineCrop = crops[0];
  for (const crop of crops) {
    const text = await readText(crop, "corner");
    const parsed = parseCollectorLine(text);
    if (!lineRead || usable(parsed) || (parsed.set && parsed.number && !(line.set && line.number))) {
      lineRead = text;
      line = parsed;
      lineCrop = crop;
    }
    if (usable(parsed)) break;
  }
  return { lineRead, line, lineCrop };
}

export async function scanCard(card: HTMLCanvasElement, onStep?: (step: string) => void): Promise<ScanOutput> {
  const started = performance.now();
  const timing: Record<string, number> = {};
  const since = (t: number) => Math.round(performance.now() - t);
  // Each text is read from a few crops in turn (the box a little lower or higher, gray or black and white) until one
  // works: frames differ, and the card's edges are found a few pixels off now and then.
  const shifted = (r: Rect, dy: number, dh = 0): Rect => ({ ...r, y: r.y + dy, h: r.h + dh });
  const nameCrops = [
    ocrCrop(card, REGIONS.name, 900, false),
    ocrCrop(card, shifted(REGIONS.name, 0.008, 0.012), 900, false),
    ocrCrop(card, REGIONS.name, 900, true),
  ];
  const lineCrops = [
    ocrCrop(card, REGIONS.collector, 1100, false),
    ocrCrop(card, shifted(REGIONS.collector, 0.02, -0.01), 1100, false),
    ocrCrop(card, shifted(REGIONS.collector, -0.03), 1100, false),
    ocrCrop(card, REGIONS.collector, 1100, true),
  ];
  const prints = photoPrints(card);
  const validSets = await setCodes().catch(() => null);
  const index = await ifReady(nameIndex());
  timing.prepare = since(started);

  onStep?.("Reading the name and the corner (the first scan loads the reader, about 10 MB)…");
  // Name and corner are read at the same time, by two readers.
  const t0 = performance.now();
  const [named, corner] = await Promise.all([
    readName(nameCrops, index).finally(() => (timing.name = since(t0))),
    readCorner(lineCrops, validSets).finally(() => (timing.corner = since(t0))),
  ]);
  const { nameRead, nameMatch, nameVia, nameCrop } = named;
  const { lineRead, line, lineCrop } = corner;

  onStep?.("Looking it up on Scryfall…");
  const t1 = performance.now();
  const setsFor = (code: string | null) => (code ? (validSets ? setCodeVariants(code, validSets) : [code]) : []);
  // With the name found, the corner is first matched against that card's own printings: no extra calls.
  let printings: Printing[] | null = nameMatch ? await printingsOf(nameMatch.oracleId) : null;
  let linePrinting: Printing | null = null;
  let fixedFrom: string | null = null;
  if (printings && line.set && line.number) {
    const sets = setsFor(line.set);
    const exact = printings.find((p) => sets.includes(p.set) && p.number === line.number);
    if (exact) [linePrinting, fixedFrom] = [exact, exact.set !== line.set ? line.set : null];
  }
  if (!linePrinting) {
    const lookup = await cardByLine(line, prints, nameMatch).catch(() => ({ printing: null, fixedFrom: null }));
    [linePrinting, fixedFrom] = [lookup.printing, lookup.fixedFrom];
  }
  // The name and the corner check each other: a misread digit points at another card, which the name gives away.
  const agree = !!nameMatch && !!linePrinting && nameMatch.oracleId === linePrinting.oracleId;
  const oracleId = (agree || !nameMatch ? linePrinting?.oracleId : nameMatch.oracleId) || nameMatch?.oracleId;
  if (oracleId && (!printings || printings[0]?.oracleId !== oracleId)) printings = await printingsOf(oracleId);
  timing.lookup = since(t1);

  let candidates: Ranked[] = [];
  let artOrder: string[] = [];
  const t2 = performance.now();
  if (oracleId && printings) {
    onStep?.("Comparing the picture with every printing…");
    ({ candidates, artOrder } = await rank(prints, printings));
  }
  timing.pictures = since(t2);

  // When the name found the card but the corner didn't land on one of its printings (a misread digit: "C002" for
  // 0012; an unreadable set code: "TEV" for TRK), the corner only has to pick among that card's own printings:
  // the only printing with that number, else the only one (or the nearest number) in that set.
  let finalLine = linePrinting;
  if (nameMatch && candidates.length && (!linePrinting || linePrinting.oracleId !== nameMatch.oracleId) && (line.set || line.number)) {
    const sets = setsFor(line.set);
    const num = (p: { number: string }) => parseInt(p.number, 10);
    const byNum = candidates.filter((c) => c.number === line.number);
    const bySet = candidates.filter((c) => sets.includes(c.set));
    const nearest =
      bySet.length > 1 && line.number
        ? [...bySet].sort((a, b) => Math.abs(num(a) - Number(line.number)) - Math.abs(num(b) - Number(line.number)))[0]
        : undefined;
    const pick = (byNum.length === 1 ? byNum[0] : undefined) ?? (bySet.length === 1 ? bySet[0] : nearest);
    if (pick) {
      finalLine = pick;
      fixedFrom = `${(line.set ?? "?").toUpperCase()} #${line.number ?? "?"}`;
    }
  }
  const shown = document.createElement("canvas");
  shown.width = 630;
  shown.height = 880;
  shown.getContext("2d")?.drawImage(card, 0, 0, 630, 880);
  return {
    cardImage: shown.toDataURL("image/jpeg", 0.8),
    nameImage: nameCrop.toDataURL("image/png"),
    lineImage: lineCrop.toDataURL("image/png"),
    nameRead,
    nameMatch,
    nameVia,
    lineRead,
    line,
    linePrinting: finalLine,
    lineFixedFrom: fixedFrom,
    // The corner pointed at another card and the card's own printings couldn't fix it.
    disagree: !!nameMatch && !!linePrinting && !agree && finalLine === linePrinting,
    prints,
    candidates,
    artOrder,
    timing,
    ms: Math.round(performance.now() - started),
  };
}
