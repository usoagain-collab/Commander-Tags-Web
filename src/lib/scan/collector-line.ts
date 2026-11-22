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

  for (const line of lines) {
    // Set line: a 3-5 letter/number code, a separator, then a language code.
    if (!out.set) {
      const m = /([A-Za-z0-9]{3,5})\s*(\S)?\s*([A-Za-z]{2})\b/.exec(line);
      if (m && LANGS[m[3].toUpperCase()]) {
        const code = m[1].toUpperCase();
        // A set code always has a letter; a bare number here is the collector number.
        if (/[A-Z]/.test(code)) {
          out.set = code.toLowerCase();
          out.lang = LANGS[m[3].toUpperCase()];
          const sep = m[2] ?? "";
          out.foilMark = STARS.has(sep) ? "star" : DOTS.has(sep) ? "dot" : null;
          continue;
        }
      }
    }
    // Number line: digits (maybe "/ total"), then a rarity letter.
    if (!out.number) {
      // The line starts with the number; the rarity letter after it is often misread (U as V), so it's optional.
      // Cards from about 2023 print the rarity first ("C 0145"), older ones after ("123/274 R").
      const m = /^[^0-9A-Za-z]*(?:([A-Z])\s+)?([0-9OIlSB]{1,4}[a-z]?)(?:\s*\/\s*[0-9OIlSB]{1,4})?(?:\s+([A-Z]))?(?![0-9A-Za-z])/.exec(line);
      if (m) {
        const n = cleanNumber(m[2]);
        // At least two real digits, so a stray letter or a lone "1" isn't taken for a number.
        if (n && (m[2].match(/\d/g)?.length ?? 0) >= 2) {
          out.number = n;
          const letter = m[1] ?? m[3];
          const r = letter === "V" ? "U" : letter;
          out.rarity = r && RARITIES.has(r) ? r : null;
        }
      }
    }
  }
  return out;
}
