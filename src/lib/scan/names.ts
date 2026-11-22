// Card scanner experiment (Nov 22, 2026): find the card name closest to what OCR read, by counting letter edits.
// Scryfall's own fuzzy search gives up when the first letter is wrong ("Cotacean Ons" finds nothing, though it's two
// letters off "Cetacean Ops"), so the lab also compares against Scryfall's list of every card name (~35,600, 700 KB)
// plus the flavor names printed on Universes Beyond cards ("Worf, Regent of Terok Nor" is a Mogis printing).

export const simplify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

// OCR often adds junk after the name (the mana cost, a dash): cut at a long dash, keep name characters only, and drop
// a stray letter or digit at the end. A bar is usually a misread L ("| one Wander" = "Lone Wanderer"), so it becomes l.
export function cleanNameRead(text: string): string {
  return text
    .split(/[—–]/)[0]
    .replace(/\|/g, "l")
    .replace(/[^A-Za-z0-9',.\- ]+/g, " ")
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
  names: string[]; // as printed on the card (a flavor name, or a double-faced card's front face, on its own too)
  targets: string[]; // the card's real name, to look it up on Scryfall
  keys: string[]; // simplified, same order
}

// `flavors`: [printed flavor name, real card name] pairs.
export function buildNameIndex(catalog: string[], flavors: [string, string][] = []): NameIndex {
  const index: NameIndex = { names: [], targets: [], keys: [] };
  const add = (name: string, target: string) => {
    const key = simplify(name);
    if (key.length >= 2) {
      index.names.push(name);
      index.targets.push(target);
      index.keys.push(key);
    }
  };
  for (const n of catalog) {
    add(n, n);
    if (n.includes(" // ")) add(n.split(" // ")[0], n);
  }
  for (const [flavor, real] of flavors) add(flavor, real);
  return index;
}

export interface NameGuess {
  name: string; // as printed
  target: string; // the real card name
  distance: number;
  share: number; // edits as a share of the name's length (0 = exact)
}

// The closest name, if it is close enough: at most a third of the letters wrong.
export function closestName(text: string, index: NameIndex, maxShare = 0.34): NameGuess | null {
  const key = simplify(cleanNameRead(text));
  if (key.length < 3) return null;
  let best: NameGuess | null = null;
  // Short names need an exact spelling: one wrong letter in "Hen" already makes "Hex" (round 8, a Hero token).
  let bestDistance = key.length < 6 ? 0 : Math.floor(key.length * maxShare);
  for (let i = 0; i < index.keys.length; i++) {
    const k = index.keys[i];
    const d = editDistance(key, k, bestDistance);
    if (d <= bestDistance && (!best || d < best.distance || (d === best.distance && k.length === key.length))) {
      best = { name: index.names[i], target: index.targets[i], distance: d, share: d / Math.max(key.length, k.length) };
      bestDistance = d;
    }
  }
  return best && best.share <= maxShare ? best : null;
}

/* ---------- set codes: fixing a misread code in the corner ---------- */

// Letters and digits the reader mixes up in the small corner print (seen: SDS read as SOS, TRK as TREK, TRC as IRC).
const LOOKALIKE: Record<string, string> = {
  O: "D0Q", D: "O0", "0": "OD", Q: "O0", I: "1LT", T: "I", "1": "IL", L: "I1", S: "5", "5": "S", B: "8", "8": "B",
  Z: "2", "2": "Z", G: "C6", C: "G", "6": "G", E: "F", F: "E", U: "V", V: "U", M: "N", N: "M", H: "N", K: "X", X: "K",
};

// Codes one slip away from `code` that are real set codes: the code itself (when real), one character swapped for a
// lookalike, or one character dropped (TREK → TRK). Most likely first, at most `limit`.
export function setCodeVariants(code: string, valid: Set<string>, limit = 6): string[] {
  const up = code.toUpperCase();
  const out: string[] = [];
  const add = (c: string) => {
    const lc = c.toLowerCase();
    if (c.length >= 2 && valid.has(lc) && !out.includes(lc)) out.push(lc);
  };
  add(up);
  add(`T${up}`); // tokens: the card prints FIN, Scryfall files it as TFIN
  for (let i = 0; i < up.length; i++) for (const r of LOOKALIKE[up[i]] ?? "") add(up.slice(0, i) + r + up.slice(i + 1));
  for (let i = 0; i < up.length; i++) add(up.slice(0, i) + up.slice(i + 1));
  return out.slice(0, limit);
}

/* ---------- is a lookup believable? ---------- */

// Every name printed on the card `realName` (its own name, each face, flavor names) from the index.
export function printedNames(realName: string, index: NameIndex | null): string[] {
  const out = [realName, ...realName.split(" // ")];
  if (index) for (let i = 0; i < index.targets.length; i++) if (index.targets[i] === realName) out.push(index.names[i]);
  return [...new Set(out)];
}

// Whether what OCR read could be one of `names`: a third of the letters off at most, after trailing junk is allowed
// for ("Fortified Village dura"). Scryfall's fuzzy search answers almost anything: junk read off a Final Fantasy
// card ("PE N a ry Ad Shr") came back as Vadrok, Apex of Thunder (David's round 5 scans), and a wrong card is worse
// than none.
export function nameFits(read: string, names: string[], maxShare = 0.4): boolean {
  const key = simplify(cleanNameRead(read));
  if (key.length < 3) return false;
  return names.some((n) => {
    const k = simplify(n);
    if (!k) return false;
    const limit = Math.floor(k.length * maxShare);
    const whole = editDistance(key, k, limit);
    const start = key.length > k.length ? editDistance(key.slice(0, k.length), k, limit) : whole;
    return Math.min(whole, start) <= limit;
  });
}
