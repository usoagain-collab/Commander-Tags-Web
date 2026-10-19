// Reading what the browser hands us when a card is dragged in from a Scryfall tab.
//
// Dragging a card image on scryfall.com gives some mix of:
//   text/uri-list  the card page link (https://scryfall.com/card/c21/263/sol-ring) or the image URL
//   text/html      the <a href=...><img src="https://cards.scryfall.io/grid/front/4/c/<id>.webp" alt="Sol Ring (Commander 2021 #263)"></a>
//   text/plain     usually the same link
// From those we pull, in order of reliability: the Scryfall card id (from the image URL),
// the set + collector number (from the card page link), and the card name (from alt text or plain text).

export type DropRef = {
  scryfallId?: string;
  set?: string;
  number?: string;
  name?: string;
};

export type DataLike = { types: readonly string[]; getData: (type: string) => string };

const IMAGE_ID = /cards\.scryfall\.io\/[a-z_]+\/(?:front|back)\/[0-9a-f]\/[0-9a-f]\/([0-9a-f-]{36})\./i;
const API_ID = /api\.scryfall\.com\/cards\/([0-9a-f-]{36})(?:[/?#]|$)/i;
const CARD_PAGE = /(?:^|\/\/)(?:www\.|tagger\.)?scryfall\.com\/card\/([a-z0-9]+)\/([^/?#\s]+)/i;

export function parseScryfallUrl(url: string): DropRef {
  const id = url.match(IMAGE_ID)?.[1] ?? url.match(API_ID)?.[1];
  if (id) return { scryfallId: id.toLowerCase() };
  const page = url.match(CARD_PAGE);
  if (page) return { set: page[1].toLowerCase(), number: decodeURIComponent(page[2]) };
  return {};
}

/** "Sol Ring (Commander 2021 #263)" -> "Sol Ring" */
export function cleanAltName(alt: string) {
  return alt.replace(/\s*\([^)]*#[^)]*\)\s*$/, "").trim();
}

function attr(tag: string, name: string) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[2] ?? m[3]).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'") : undefined;
}

/** Pulls the image src, link href and alt text out of dragged HTML. */
export function parseDroppedHtml(html: string): DropRef {
  const img = html.match(/<img\b[^>]*>/i)?.[0];
  const a = html.match(/<a\b[^>]*>/i)?.[0];
  const src = img ? attr(img, "src") : undefined;
  const href = a ? attr(a, "href") : undefined;
  const alt = img ? (attr(img, "alt") ?? attr(img, "title")) : undefined;
  return {
    ...(href ? parseScryfallUrl(href) : {}),
    ...(src ? parseScryfallUrl(src) : {}), // image id wins over the page link
    ...(alt ? { name: cleanAltName(alt) } : {}),
  };
}

/** Everything we can learn from a drop, merged. Returns null if nothing looks like a card. */
export function readDrop(data: DataLike): DropRef | null {
  const has = (t: string) => data.types.includes(t);
  let ref: DropRef = {};
  if (has("text/html")) ref = { ...ref, ...parseDroppedHtml(data.getData("text/html")) };
  for (const t of ["text/uri-list", "text/plain"]) {
    if (!has(t)) continue;
    const text = data
      .getData(t)
      .split(/\r?\n/)
      .find((l) => l.trim() && !l.startsWith("#"))
      ?.trim();
    if (!text) continue;
    const fromUrl = parseScryfallUrl(text);
    // Keep the strongest id we have; fill in missing pieces.
    ref = { ...fromUrl, ...ref };
    // Plain text that isn't a URL is probably a typed or copied card name.
    if (t === "text/plain" && !/^https?:\/\//i.test(text) && !ref.name && text.length <= 150) ref.name = text;
  }
  return ref.scryfallId || ref.set || ref.name ? ref : null;
}

/** True while dragging something that might be a card (not, say, a file from the desktop). */
export function looksDroppable(types: readonly string[]) {
  return !types.includes("Files") && types.some((t) => t === "text/uri-list" || t === "text/html" || t === "text/plain");
}
