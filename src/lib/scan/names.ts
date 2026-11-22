// Card scanner experiment (Nov 22, 2026): find the card name closest to what OCR read, by counting letter edits.
// Scryfall's own fuzzy search gives up when the first letter is wrong ("Cotacean Ons" finds nothing, though it's two
// letters off "Cetacean Ops"), so the lab also compares against Scryfall's list of every card name (~35,600, 700 KB).

export const simplify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

// OCR often adds junk after the name (the mana cost, a dash): cut at a dash or bar, keep name characters only, and
// drop a stray letter or digit at the end.
export function cleanNameRead(text: string): string {
  return text
    .split(/[—–|]/)[0]
    .replace(/[^A-Za-z0-9',\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\s+\S{1,2})+$/, "")
    .trim();
}

// Letter edits (insert, delete, change) to turn a into b; gives up early once past `limit`.
export function editDistance(a: string, b: string, limit = Infinity): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

export interface NameIndex {
  names: string[]; // as Scryfall writes them (a double-faced card's front face on its own too)
  keys: string[]; // simplified, same order
}

export function buildNameIndex(catalog: string[]): NameIndex {
  const names: string[] = [];
  const keys: string[] = [];
  const add = (name: string) => {
    const key = simplify(name);
    if (key.length >= 2) {
      names.push(name);
      keys.push(key);
    }
  };
  for (const n of catalog) {
    add(n);
    if (n.includes(" // ")) add(n.split(" // ")[0]);
  }
  return { names, keys };
}

export interface NameGuess {
  name: string;
  distance: number;
  share: number; // edits as a share of the name's length (0 = exact)
}

// The closest name, if it is close enough: at most a third of the letters wrong.
export function closestName(text: string, index: NameIndex, maxShare = 0.34): NameGuess | null {
  const key = simplify(text);
  if (key.length < 3) return null;
  let best: NameGuess | null = null;
  let bestDistance = Math.floor(key.length * maxShare);
  for (let i = 0; i < index.keys.length; i++) {
    const k = index.keys[i];
    const d = editDistance(key, k, bestDistance);
    if (d <= bestDistance && (!best || d < best.distance || (d === best.distance && k.length === key.length))) {
      best = { name: index.names[i], distance: d, share: d / Math.max(key.length, k.length) };
      bestDistance = d;
    }
  }
  return best && best.share <= maxShare ? best : null;
}
