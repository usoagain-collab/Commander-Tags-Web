// Card search helpers. The browser sends full Scryfall syntax straight to Scryfall's search API
// (CLAUDE.md: Phase 2 decisions); these pure functions build that query and power tag autocomplete.

export type SearchFilters = {
  /** The deck's color identity (commander colors), or null when there's no commander yet. */
  identity: Set<string> | null;
  /** Limit to the commander's colors (on by default once there's a commander). */
  inIdentity: boolean;
  /** Limit to Commander-legal, paper cards. */
  legalOnly: boolean;
};

// If the user already wrote one of these, don't add our own version of it.
const HAS_IDENTITY = /(^|[\s(])-?(id|identity|ci|commander)(<=|>=|=|:|<|>)/i;
const HAS_FORMAT = /(^|[\s(])-?(f|format|legal|banned|restricted)(:|=)/i;
const HAS_GAME = /(^|[\s(])-?game(:|=)/i;

/** The query actually sent to Scryfall: what the user typed, plus the automatic filters. */
export function buildQuery(userQuery: string, filters: SearchFilters): string {
  const q = userQuery.trim();
  const extra: string[] = [];
  if (filters.inIdentity && filters.identity && !HAS_IDENTITY.test(q)) {
    const colors = ["W", "U", "B", "R", "G"].filter((c) => filters.identity!.has(c)).join("");
    extra.push(`id<=${colors.toLowerCase() || "c"}`);
  }
  if (filters.legalOnly) {
    if (!HAS_FORMAT.test(q)) extra.push("f:commander");
    if (!HAS_GAME.test(q)) extra.push("game:paper");
  }
  if (!q) return extra.join(" ");
  // Wrap the user's part in parentheses so a top-level "or" can't escape our filters.
  return extra.length ? `(${q}) ${extra.join(" ")}` : q;
}

export function scryfallSearchUrl(query: string, order = "edhrec") {
  const params = new URLSearchParams({ q: query, order, unique: "cards" });
  return `https://api.scryfall.com/cards/search?${params}`;
}

// ---------- tag autocomplete ----------

export type TagKind = "oracle" | "art";

/** Scryfall's keywords for oracle (function) tags and art tags. */
const TAG_KEYWORDS: Record<string, TagKind> = {
  otag: "oracle",
  oracletag: "oracle",
  function: "oracle",
  art: "art",
  atag: "art",
  arttag: "art",
};

export type TagToken = {
  kind: TagKind;
  /** What's typed after the colon so far (lowercase, may be empty). */
  partial: string;
  /** Where the slug part starts and ends in the text, so a pick can replace it. */
  start: number;
  end: number;
};

/** If the cursor sits inside a word like "otag:ram" or "-art:fro", returns what's being typed. */
export function tagTokenAt(text: string, caret: number): TagToken | null {
  // The word around the cursor: back to whitespace or "(", forward to whitespace or ")".
  let wordStart = caret;
  while (wordStart > 0 && !/[\s(]/.test(text[wordStart - 1])) wordStart--;
  let wordEnd = caret;
  while (wordEnd < text.length && !/[\s)]/.test(text[wordEnd])) wordEnd++;
  const word = text.slice(wordStart, wordEnd);

  const m = word.match(/^-?([a-z]+)[:=]([a-z0-9-]*)$/i);
  if (!m) return null;
  const kind = TAG_KEYWORDS[m[1].toLowerCase()];
  if (!kind) return null;
  const start = wordStart + word.length - m[2].length;
  if (caret < start) return null; // cursor is still in the keyword, not the slug
  return { kind, partial: m[2].toLowerCase(), start, end: wordEnd };
}

/** Puts a chosen slug into the text in place of the partial one; returns the new text and cursor spot. */
export function insertTag(text: string, token: TagToken, slug: string): { text: string; caret: number } {
  const before = text.slice(0, token.start) + slug;
  const after = text.slice(token.end);
  // Always leave one space after the slug, so the next filter can be typed straight away.
  const next = before + (after.startsWith(" ") ? after : " " + after);
  return { text: next.replace(/\s+$/, " "), caret: before.length + 1 };
}

/** Orders tag matches: slug starts with the text, then a word in it does, then anywhere; bigger tags first. */
export function rankTags<T extends { slug: string; size: number }>(tags: T[], partial: string): T[] {
  const score = (slug: string) =>
    slug.startsWith(partial) ? 0 : slug.split("-").some((w) => w.startsWith(partial)) ? 1 : 2;
  return [...tags].sort((a, b) => score(a.slug) - score(b.slug) || b.size - a.size || a.slug.localeCompare(b.slug));
}
