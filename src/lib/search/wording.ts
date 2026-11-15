// Searching by a card's wording (v2, Nov 10, 2026; DefCat lesson 3: read what the card actually says).
// Rules text is written the way Scryfall searches it: lower case, the card's own name as ~, so a phrase like
// "when ~ enters" finds every card with that wording whatever its name. The same rule runs in SQL as
// public.oracle_norm (migration 0048), which Suggest will use for wording matches.

/** The names a card's text may use for itself: full name, each face, and a legend's short name before the comma. */
function selfNames(name: string, typeLine: string): string[] {
  const full = name.toLowerCase().trim();
  const names = new Set([full]);
  const legendary = typeLine.toLowerCase().includes("legendary");
  for (const face of full.split(" // ")) {
    names.add(face);
    if (!legendary) continue;
    // "Omo, Queen of Vesuva" says Omo; "Loran of the Third Path" says Loran.
    const short = face.includes(",") ? face.split(",")[0].trim() : (face.match(/^(\S+) of /)?.[1] ?? "");
    if (short.length >= 3) names.add(short);
  }
  return [...names].filter(Boolean).sort((a, b) => b.length - a.length);
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lower case, the card's own names as ~ (whole words only), like Scryfall's search syntax. */
export function normalizeOracle(text: string, name: string, typeLine = ""): string {
  let t = text.toLowerCase();
  for (const n of selfNames(name, typeLine)) {
    t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(n)}(?![\\p{L}\\p{N}])`, "gu"), "~");
  }
  return t;
}

/** A phrase as a Scryfall rules-text search. Scryfall reads ~ as "this card's name". */
export function wordingQuery(phrase: string): string {
  return `o:"${phrase.replace(/"/g, "").trim()}"`;
}

/** Text the user selected in a card's rules text, cleaned into a phrase (or null when too short to search). */
export function selectionPhrase(selected: string, name: string, typeLine = ""): string | null {
  const t = normalizeOracle(selected, name, typeLine)
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:—–-]+|[\s.,;:—–-]+$/g, "")
    .trim();
  if (t.replace(/[^\p{L}\p{N}~]/gu, "").length < 3) return null;
  return t.length > 120 ? t.slice(0, 120).replace(/\s\S*$/, "") : t;
}

// ---------- phrases cut from a card's rules text ----------

// Verbs that start an effect worth searching for. "counter" only as "counter target".
const VERBS = [
  "put", "create", "draw", "discard", "sacrifice", "exile", "return", "destroy", "mill", "search", "scry",
  "surveil", "gain", "lose", "untap", "tap", "copy", "cast", "play", "reveal", "proliferate", "fight", "double",
  "investigate", "explore", "connive", "populate", "amass", "goad", "manifest", "flicker", "transform",
];
const VERB_RE = new RegExp(`(?<![\\p{L}~])(?:${VERBS.join("|")}|counter(?= target))(?![\\p{L}])`, "gu");
// One-word actions that are searchable alone.
const SOLO = new Set(["proliferate", "investigate", "explore", "connive", "populate", "goad", "manifest"]);
// An effect phrase stops at these.
const STOP = new Set(["and", "and/or", "then", "until", "unless", "if", "where", "instead", "as", "except", "this", "way"]);
// Words a phrase shouldn't end on.
const TRAILING = new Set([
  "a", "an", "the", "of", "on", "to", "target", "up", "each", "any", "you", "your", "its", "with", "from", "into",
  "onto", "that", "in", "at", "for", "by", "all", "or", "another", "one", "their", "his", "her",
]);
// So common they say little about a deck (draw a card is on about 1,500 cards): shown last.
const COMMON = new Set(["draw a card", "discard a card", "gain life", "create a treasure token", "exile the top card"]);
const NOT_COUNTER = new Set(["a", "the", "that", "each", "of", "those", "any", "no", "one", "more", "additional", "many", "number", "those", "two", "three", "x"]);
const MAX_WORDS_AFTER_VERB = 4;
const MAX_TRIGGER_WORDS = 9;

const words = (s: string) => s.split(/\s+/).filter(Boolean);

function trimTrailing(ws: string[]): string[] {
  const out = [...ws];
  while (out.length > 1 && TRAILING.has(out[out.length - 1])) out.pop();
  return out;
}

/** Effect phrases in one clause: each verb plus up to four words, stopping at punctuation, digits and joining words. */
function effectPhrases(clause: string): string[] {
  const found: string[] = [];
  for (const m of clause.matchAll(VERB_RE)) {
    const rest = clause.slice(m.index! + m[0].length).split(/[,.;:•]/)[0];
    const taken = [m[0]];
    for (const w of words(rest)) {
      if (STOP.has(w) || /^[\dx]+$/.test(w) || /[{}]/.test(w) || taken.length > MAX_WORDS_AFTER_VERB) break;
      taken.push(w);
    }
    const phrase = trimTrailing(taken);
    // A verb plus only a pronoun says nothing on its own ("put the rest", "return it", "exile them").
    if (phrase.length === 2 && /^(it|them|the rest|those|that)$/.test(phrase[1])) continue;
    if (phrase.length === 3 && phrase.slice(1).join(" ") === "the rest") continue;
    if (phrase.length >= 2 || SOLO.has(phrase[0])) found.push(phrase.join(" "));
  }
  return found;
}

/**
 * Searchable phrases from a card's rules text, most useful first: triggers ("whenever a land you control enters"),
 * ability words ("landfall"), effects and costs ("sacrifice a creature", "return a land you control") and kinds of
 * counters ("everything counter"). Pattern rules, not a parser: good on most cards, and the selection search is
 * there for the rest.
 */
export function wordingPhrases(text: string, name: string, typeLine = "", max = 10): string[] {
  const t = normalizeOracle(text, name, typeLine).replace(/\([^)]*\)/g, " ");
  const triggers: string[] = [];
  const abilityWords: string[] = [];
  const effects: string[] = [];
  const counters: string[] = [];

  for (let line of t.split("\n")) {
    line = line.trim();
    if (!line || line === "//") continue;
    // Ability word: "landfall — whenever …".
    const aw = line.match(/^([a-z][a-z' ]{2,30}) — (.*)$/);
    if (aw && words(aw[1]).length <= 3) {
      abilityWords.push(aw[1].trim());
      line = aw[2];
    }
    // Loyalty ability cost: "+1: …".
    line = line.replace(/^[+−-]?[\dx]+: /, "");
    for (let sentence of line.split(/(?<=\.)\s+/)) {
      sentence = sentence.replace(/\.$/, "").trim();
      const trig = sentence.match(/^(whenever|when|at the beginning of) ([^,]+)/);
      if (trig) {
        const phrase = `${trig[1]} ${trig[2]}`.trim();
        if (words(phrase).length <= MAX_TRIGGER_WORDS) triggers.push(phrase);
        sentence = sentence.slice(trig[0].length);
      }
      // An activated ability's cost ("sacrifice a creature: …") is a clause of its own.
      for (const clause of sentence.split(/: /)) effects.push(...effectPhrases(clause));
      for (const m of sentence.matchAll(/([+-]\d+\/[+-]\d+|[a-z]+) counters?(?![a-z])/g)) {
        if (!NOT_COUNTER.has(m[1]) && !VERBS.includes(m[1])) counters.push(`${m[1]} counter`);
      }
    }
  }

  const out: string[] = [];
  const all = [...triggers, ...abilityWords, ...effects, ...counters];
  for (const p of [...all.filter((x) => !COMMON.has(x)), ...all.filter((x) => COMMON.has(x))]) {
    if (!out.includes(p)) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
