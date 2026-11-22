// Card scanner experiment (Nov 21, 2026): the browser side of one test scan.
// 1. Straighten the crop into a flat 630 × 880 card.  2. Read the name and the collector line with Tesseract (free OCR,
// runs on the phone).  3. Look both up on Scryfall.  4. Compare the picture with every printing of the card.
// Everything here runs in the browser; the photo never leaves the phone.

import { parseCollectorLine, type CollectorLine } from "./collector-line";
import { CARD_RATIO, colorDistance, colorGrid, dHash, findCardBounds, hamming, matchScore, otsu, REGIONS, scaleRect, toGray, type Pixels, type Rect } from "./image";

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
  lineRead: string;
  line: CollectorLine;
  linePrinting: Printing | null;
  disagree: boolean; // the name and the corner point at different cards
  prints: PhotoPrints;
  candidates: Ranked[]; // sorted by whole-card score, best first
  artOrder: string[]; // printing keys sorted by art score
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

// Cut `rect` out of the source and find the card's edges inside it (on a smaller copy, for speed).
export function straighten(source: CanvasImageSource, srcW: number, srcH: number, rect: Rect | null, refine: boolean): HTMLCanvasElement {
  const r = rect ?? { x: 0, y: 0, w: srcW, h: srcH };
  let inner: Rect = { x: 0, y: 0, w: r.w, h: r.h };
  if (refine) {
    const s = Math.min(1, 600 / Math.max(r.w, r.h));
    const [, sctx] = canvas(r.w * s, r.h * s);
    sctx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, sctx.canvas.width, sctx.canvas.height);
    const b = findCardBounds(pixelsOf(sctx, sctx.canvas.width, sctx.canvas.height));
    inner = { x: b.x / s, y: b.y / s, w: b.w / s, h: b.h / s };
  }
  const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, inner.w)));
  const h = Math.round(w / CARD_RATIO);
  const [c, ctx] = canvas(w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, r.x + inner.x, r.y + inner.y, inner.w, inner.h, 0, 0, w, h);
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
let workerPromise: Promise<TessWorker> | null = null;

// Loaded on first use: about 10 MB the first time (Tesseract's engine and English data, from the jsDelivr CDN), cached after.
export function ocrWorker(): Promise<TessWorker> {
  workerPromise ??= import("tesseract.js").then(({ createWorker }) => createWorker("eng"));
  workerPromise.catch(() => (workerPromise = null));
  return workerPromise;
}

async function readText(image: HTMLCanvasElement, mode: "line" | "block"): Promise<string> {
  const w = await ocrWorker();
  // Page segmentation modes: 7 = one line of text, 6 = one block.
  await w.setParameters({ tessedit_pageseg_mode: (mode === "line" ? "7" : "6") as never });
  const { data } = await w.recognize(image);
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
  };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scry<T>(path: string): Promise<T | null> {
  await pause(100); // Scryfall asks for 10 requests a second at most
  const res = await fetch(`${API}${path}`, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Scryfall answered ${res.status}`);
  return (await res.json()) as T;
}

export async function cardByName(text: string): Promise<Printing | null> {
  const clean = text.replace(/[^A-Za-z0-9',\- ]+/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length < 3) return null;
  const c = await scry<ScryCard>(`/cards/named?${new URLSearchParams({ fuzzy: clean })}`);
  return c ? toPrinting(c) : null;
}

async function cardByLine(line: CollectorLine): Promise<Printing | null> {
  if (!line.set || !line.number) return null;
  const base = `/cards/${encodeURIComponent(line.set)}/${encodeURIComponent(line.number)}`;
  const c = (line.lang ? await scry<ScryCard>(`${base}/${line.lang}`) : null) ?? (await scry<ScryCard>(base));
  return c ? toPrinting(c) : null;
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
  for (let i = 0; i < printings.length; i += 8) {
    const batch = printings.slice(i, i + 8);
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

export async function scanCard(card: HTMLCanvasElement, onStep?: (step: string) => void): Promise<ScanOutput> {
  const started = performance.now();
  const nameCrops = [ocrCrop(card, REGIONS.name, 900, false), ocrCrop(card, REGIONS.name, 900, true)];
  const lineCrops = [ocrCrop(card, REGIONS.collector, 1100, false), ocrCrop(card, REGIONS.collector, 1100, true)];
  const prints = photoPrints(card);

  onStep?.("Reading the text (the first scan loads the reader, about 10 MB)…");
  // The name is read gray first; if Scryfall finds no card for that, again in black and white.
  let nameRead = "";
  let nameMatch: Printing | null = null;
  let nameCrop = nameCrops[0];
  for (const crop of nameCrops) {
    const text = await readText(crop, "line");
    const match = await cardByName(text).catch(() => null);
    if (!nameRead || match) {
      nameRead = text;
      nameMatch = match;
      nameCrop = crop;
    }
    if (match) break;
  }
  // Read the corner gray first; if that doesn't give a set and a number, try the black-and-white version.
  let lineRead = "";
  let line = parseCollectorLine("");
  let lineCrop = lineCrops[0];
  for (const crop of lineCrops) {
    const text = await readText(crop, "block");
    const parsed = parseCollectorLine(text);
    if (!lineRead || (parsed.set && parsed.number)) {
      lineRead = text;
      line = parsed;
      lineCrop = crop;
    }
    if (parsed.set && parsed.number) break;
  }

  onStep?.("Looking it up on Scryfall…");
  const linePrinting = await cardByLine(line).catch(() => null);
  // The name and the corner check each other: a misread digit points at another card, which the name gives away.
  const agree = !!nameMatch && !!linePrinting && nameMatch.oracleId === linePrinting.oracleId;
  const oracleId = (agree || !nameMatch ? linePrinting?.oracleId : nameMatch.oracleId) || nameMatch?.oracleId;

  let candidates: Ranked[] = [];
  let artOrder: string[] = [];
  if (oracleId) {
    onStep?.("Comparing the picture with every printing…");
    ({ candidates, artOrder } = await rank(prints, await printingsOf(oracleId)));
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
    lineRead,
    line,
    linePrinting,
    disagree: !!nameMatch && !!linePrinting && !agree,
    prints,
    candidates,
    artOrder,
    ms: Math.round(performance.now() - started),
  };
}
