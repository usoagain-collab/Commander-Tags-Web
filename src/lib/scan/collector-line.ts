// Card scanner experiment (Nov 21, 2026): read the small print in a card's bottom-left corner.
// Since Magic 2015 cards print it in two short lines, for example
//   "0123 R"        or  "123/274 R"   (collector number, sometimes "/ set size", rarity letter)
//   "MOM • EN"                          (set code, a dot, language code)
// Recent cards are said to print a star (★) instead of the dot on foils; the experiment checks that.
// OCR gets some characters wrong (O for 0, a dot read as "*" or "-"), so the parser is forgiving and keeps the raw text.

export type FoilMark = "star" | "dot" | null;

export interface CollectorLine {
  number: string | null; // as Scryfall writes it: no leading zeros, a trailing letter kept ("123a")
  set: string | null; // lower case, as Scryfall writes set codes
  lang: string | null; // Scryfall language code (en, ja, zhs…)
  rarity: string | null; // C U R M S L T P, as printed
  foilMark: FoilMark;
}

// Printed language codes and the codes Scryfall uses for them.
const LANGS: Record<string, string> = {
  EN: "en", DE: "de", FR: "fr", IT: "it", ES: "es", SP: "es", PT: "pt", JP: "ja", JA: "ja",
  RU: "ru", KO: "ko", KR: "ko", CS: "zhs", CT: "zht", ZH: "zhs", PH: "ph",
};

// A 3-5 character set code, maybe a separator (the dot or star, often misread), then a printed language code.
const LANG_AFTER_CODE = new RegExp(`([A-Za-z0-9]{3,5})\\s*(\\S)??\\s*(${Object.keys(LANGS).join("|")})(?![A-Za-z])`, "gi");

const RARITIES = new Set(["C", "U", "R", "M", "S", "L", "T", "P"]);
const DOTS = new Set(["•", "·", ".", "-", "–", "+", "°", "o", "e", "«", "»"]); // OCR reads the dot as « often
// Only a real star counts: the reader also turns the dot into "*", so "*" means "can't tell" (seen Nov 22, 2026).
const STARS = new Set(["★", "☆"]);

// In a number, OCR often reads 0 as O, 1 as I or l, 5 as S, 8 as B.
function digitsFrom(raw: string): string {
  return raw.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
}

export function cleanNumber(raw: string): string | null {
  const m = /^0*(\d{1,4})([a-z★]?)$/i.exec(digitsFrom(raw.trim()));
  if (!m) return null;
  return `${m[1]}${m[2].toLowerCase()}`;
}

export function parseCollectorLine(text: string): CollectorLine {
  const out: CollectorLine = { number: null, set: null, lang: null, rarity: null, foilMark: null };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (let line of lines) {
    // Set line: a 3-5 letter/number code, a separator, then a language code.
    if (!out.set) {
      // Anchored on a known language code, so it also works when the reader runs both lines together ("C002 TRK * EN").
      let at = -1;
      for (const m of line.matchAll(LANG_AFTER_CODE)) {
        const code = m[1].toUpperCase();
        // A set code always has a letter; a bare number here is the collector number.
        if (!/[A-Z]/.test(code)) continue;
        out.set = code.toLowerCase();
        out.lang = LANGS[m[3].toUpperCase()];
        const sep = m[2] ?? "";
        out.foilMark = STARS.has(sep) ? "star" : DOTS.has(sep) ? "dot" : null;
        at = m.index ?? 0;
        break;
      }
      if (at === 0) continue;
      // The number came first on the same line: read it from the part before the set code only, so the code itself
      // ("C21") is never taken for a number.
      if (at > 0) line = line.slice(0, at);
    }
    // Number line: digits (maybe "/ total"), then a rarity letter.
    if (!out.number) {
      // The line starts with the number; the rarity letter after it is often misread (U as V), so it's optional.
      // Cards from about 2023 print the rarity first ("C 0145"), older ones after ("123/274 R").
      // The rarity letter may touch the number ("M0026"); only real rarity letters, so a misread digit isn't eaten.
      const m = /^[^0-9A-Za-z]*(?:([CURMLTP])\s*|([A-Z])\s+)?([0-9OIlSB]{1,4}[a-z]?)(?:\s*\/\s*[0-9OIlSB]{1,4})?(?:\s+([A-Z]))?(?![0-9A-Za-z])/.exec(line);
      if (m) {
        const n = cleanNumber(m[3]);
        // At least two real digits, so a stray letter or a lone "1" isn't taken for a number.
        if (n && (m[3].match(/\d/g)?.length ?? 0) >= 2) {
          out.number = n;
          const letter = m[1] ?? m[2] ?? m[4];
          const r = letter === "V" ? "U" : letter;
          out.rarity = r && RARITIES.has(r) ? r : null;
        }
      }
    }
  }
  // Cards since about 2023 print the number as four digits with leading zeros ("0185"). When the reader runs the two
  // lines together with junk (David's Sulu: "3 RR 0185 5 LS 44 …"), such a number anywhere beats whatever came first.
  const padded = /(?:^|[^0-9])([CURMLTP])?\s?(0\d{3})(?![0-9])/.exec(text);
  if (padded) {
    const n = cleanNumber(padded[2]);
    if (n && n !== out.number) {
      out.number = n;
      out.rarity = padded[1] ?? out.rarity;
    }
  }
  return out;
}
