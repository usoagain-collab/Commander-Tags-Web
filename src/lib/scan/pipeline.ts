// Card scanner experiment (Nov 21, 2026): the browser side of one test scan.
// 1. Straighten the crop into a flat 630 × 880 card.  2. Read the name and the collector line with Tesseract (free OCR,
// runs on the phone).  3. Look both up on Scryfall.  4. Compare the picture with every printing of the card.
// Everything here runs in the browser; the photo never leaves the phone.

import { parseCollectorLine, type CollectorLine } from "./collector-line";
import { buildNameIndex, cleanNameRead, closestName, setCodeVariants, type NameIndex } from "./names";
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
  lineFixedFrom: string | null; // the set code as read, when a lookalike real code was used instead
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

// Cut `rect` out of the source, find the card inside it (on a smaller copy, for speed) and flatten it upright.
// First choice: the card's four edges as straight lines (houghCorners), then its outline's corners (both fix tilt
// and a photo taken at an angle, where the card is a trapezoid); then a turned rectangle; then plain edge finding;
// else the whole crop.
export async function straighten(source: CanvasImageSource, srcW: number, srcH: number, rect: Rect | null, refine: boolean): Promise<HTMLCanvasElement> {
  const r = rect ?? { x: 0, y: 0, w: srcW, h: srcH };
  let quad: Quad = { cx: r.w / 2, cy: r.h / 2, w: r.w, h: r.h, angle: 0 };
  if (refine) {
    const s = Math.min(1, 600 / Math.max(r.w, r.h));
    const [sc, sctx] = canvas(r.w * s, r.h * s);
    sctx.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, sc.width, sc.height);
    const small = pixelsOf(sctx, sc.width, sc.height);
    const corners = houghCorners(small) ?? cardCorners(small);
    if (corners) return flatten(source, r, corners.map(([x, y]) => [x / s, y / s]) as [Pt, Pt, Pt, Pt]);
    const q = locateCardQuad(small);
    if (q) {
      quad = { cx: q.cx / s, cy: q.cy / s, w: q.w / s, h: q.h / s, angle: q.angle };
    } else {
      const b = findCardBounds(small);
      quad = { cx: (b.x + b.w / 2) / s, cy: (b.y + b.h / 2) / s, w: b.w / s, h: b.h / s, angle: 0 };
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
  return c;
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
let workerPromise: Promise<TessWorker> | null = null;

// Loaded on first use: about 10 MB the first time (Tesseract's engine and English data, from the jsDelivr CDN), cached after.
export function ocrWorker(): Promise<TessWorker> {
  workerPromise ??= import("tesseract.js").then(({ createWorker }) => createWorker("eng"));
  workerPromise.catch(() => (workerPromise = null));
  return workerPromise;
}

// The characters each read may produce. A card name has no digits (the reader turned "U.S.S." into "11S S"); the
// corner is capitals, digits and a few marks (lower case let "SDS" come out "sDS").
const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ,.'-:!&";
const CORNER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/•★*. ";

async function readText(image: HTMLCanvasElement, mode: "name" | "corner"): Promise<string> {
  const w = await ocrWorker();
  // Page segmentation modes: 7 = one line of text (the name), 6 = one block (the corner's two lines).
  await w.setParameters({
    tessedit_pageseg_mode: (mode === "name" ? "7" : "6") as never,
    tessedit_char_whitelist: mode === "name" ? NAME_CHARS : CORNER_CHARS,
  });
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

async function scry<T>(path: string): Promise<T | null> {
  await pause(100); // Scryfall asks for 10 requests a second at most
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
    if (c) found.push(toPrinting(c));
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

  onStep?.("Reading the text (the first scan loads the reader, about 10 MB)…");
  // The name: until Scryfall's fuzzy search finds a card for a read. If none does, the closest name in Scryfall's full
  // list of names and flavor names (a wrong first letter defeats fuzzy search).
  let nameRead = "";
  let nameMatch: Printing | null = null;
  let nameVia: ScanOutput["nameVia"] = null;
  let nameCrop = nameCrops[0];
  const reads: { text: string; crop: HTMLCanvasElement }[] = [];
  for (const crop of nameCrops) {
    const text = await readText(crop, "name");
    reads.push({ text, crop });
    const match = await cardByName(text).catch(() => null);
    if (match) {
      [nameRead, nameMatch, nameVia, nameCrop] = [text, match, "scryfall", crop];
      break;
    }
  }
  if (!nameMatch) {
    nameRead = reads[0].text;
    const index = await nameIndex().catch(() => null);
    const guesses = index ? reads.map((r) => ({ ...r, guess: closestName(r.text, index) })).filter((r) => r.guess) : [];
    guesses.sort((a, b) => a.guess!.share - b.guess!.share);
    const best = guesses[0];
    if (best?.guess) {
      const match = await cardByExactName(best.guess.target).catch(() => null);
      if (match) [nameRead, nameMatch, nameVia, nameCrop] = [best.text, match, "closest", best.crop];
    }
  }
  // The corner: until a read gives a number and a set code that is real or one slip from a real one.
  const usable = (l: CollectorLine) => !!(l.set && l.number && (!validSets || setCodeVariants(l.set, validSets).length));
  let lineRead = "";
  let line = parseCollectorLine("");
  let lineCrop = lineCrops[0];
  for (const crop of lineCrops) {
    const text = await readText(crop, "corner");
    const parsed = parseCollectorLine(text);
    if (!lineRead || usable(parsed) || (parsed.set && parsed.number && !(line.set && line.number))) {
      lineRead = text;
      line = parsed;
      lineCrop = crop;
    }
    if (usable(parsed)) break;
  }

  onStep?.("Looking it up on Scryfall…");
  const lookup = await cardByLine(line, prints, nameMatch).catch(() => ({ printing: null, fixedFrom: null }));
  const linePrinting = lookup.printing;
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
    nameVia,
    lineRead,
    line,
    linePrinting,
    lineFixedFrom: lookup.fixedFrom,
    disagree: !!nameMatch && !!linePrinting && !agree,
    prints,
    candidates,
    artOrder,
    ms: Math.round(performance.now() - started),
  };
}
