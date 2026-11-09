// Guided filters that write Scryfall syntax (v2, Nov 8, 2026). Used by the Search panel's Filters drawer and the
// Suggest panel's filter toggles, so both speak the same syntax and the user sees (and learns) the query they make.
// Based on the searches in Jake and Joel's Scryfall guide: colors, types, rules text, mana value, price, keywords,
// sets, first printings, the Reserved List.

export type ColorMode = "including" | "at-most" | "exactly";

export type FilterForm = {
  /** Card colors (W U B R G, C = colorless), matched by `colorMode`. */
  colors: string[];
  colorMode: ColorMode;
  /** Card types or subtypes; several are OR'ed ("creature or artifact"). */
  types: string[];
  /** Words the rules text must contain; ~ stands for the card's own name. */
  text: string;
  mvMin: number | null;
  mvMax: number | null;
  priceMax: number | null;
  keyword: string;
  /** Set code, e.g. "dsk". */
  set: string;
  /** Only cards first printed in this year or later (new cards, not reprints). */
  sinceYear: number | null;
  noReserved: boolean;
  instantSpeed: boolean;
};

export const EMPTY_FILTERS: FilterForm = {
  colors: [],
  colorMode: "including",
  types: [],
  text: "",
  mvMin: null,
  mvMax: null,
  priceMax: null,
  keyword: "",
  set: "",
  sinceYear: null,
  noReserved: false,
  instantSpeed: false,
};

export const FILTER_TYPES = ["Creature", "Artifact", "Enchantment", "Instant", "Sorcery", "Planeswalker", "Land", "Equipment", "Aura", "Vehicle"];

/** A word for Scryfall: quoted when it has spaces or punctuation, inner quotes dropped. */
export function quote(word: string): string {
  const w = word.trim().replace(/"/g, "");
  return /^[a-z0-9~+-]+$/i.test(w) ? w.toLowerCase() : `"${w}"`;
}

const COLOR_OP: Record<ColorMode, string> = { including: ">=", "at-most": "<=", exactly: "=" };

/** The Scryfall syntax for a form: one part per filled-in field, joined with spaces (Scryfall reads that as AND). */
export function filterSyntax(f: FilterForm): string {
  const parts: string[] = [];
  if (f.colors.length) {
    const colorless = f.colors.includes("C");
    const wubrg = ["W", "U", "B", "R", "G"].filter((c) => f.colors.includes(c)).join("").toLowerCase();
    parts.push(colorless && !wubrg ? "c=c" : `c${COLOR_OP[f.colorMode]}${wubrg || "c"}`);
  }
  const types = f.types.map((t) => `t:${quote(t)}`);
  if (types.length === 1) parts.push(types[0]);
  else if (types.length > 1) parts.push(`(${types.join(" or ")})`);
  if (f.instantSpeed) parts.push("(t:instant or kw:flash)");
  if (f.text.trim()) parts.push(`o:${quote(f.text)}`);
  if (f.keyword.trim()) parts.push(`kw:${quote(f.keyword)}`);
  if (f.mvMin != null && f.mvMax != null && f.mvMin === f.mvMax) parts.push(`mv=${f.mvMin}`);
  else {
    if (f.mvMin != null) parts.push(`mv>=${f.mvMin}`);
    if (f.mvMax != null) parts.push(`mv<=${f.mvMax}`);
  }
  if (f.priceMax != null) parts.push(`usd<=${f.priceMax}`);
  if (f.set.trim()) parts.push(`s:${quote(f.set)}`);
  if (f.sinceYear != null) parts.push(`is:firstprint year>=${f.sinceYear}`);
  if (f.noReserved) parts.push("-is:reserved");
  return parts.join(" ");
}

/** Puts a filter's syntax after what's already typed (no doubled spaces). */
export function appendSyntax(text: string, syntax: string): string {
  const t = text.trim();
  return syntax ? (t ? `${t} ${syntax}` : syntax) : t;
}

// ---------- sorting ----------

export type SearchOrder = "edhrec" | "usd" | "cmc" | "name" | "released" | "power";
export type SortDir = "auto" | "asc" | "desc";

export const SORTS: { value: SearchOrder; label: string; note: string }[] = [
  { value: "edhrec", label: "Most played", note: "most played first" },
  { value: "usd", label: "Price", note: "cheapest first" },
  { value: "cmc", label: "Mana value", note: "lowest mana value first" },
  { value: "name", label: "Name", note: "A to Z" },
  { value: "released", label: "Newest", note: "newest first" },
  { value: "power", label: "Power", note: "highest power first" },
];

/** What the results line says about the order ("most played first", or the reverse when flipped). */
export function sortNote(order: SearchOrder, dir: SortDir): string {
  const s = SORTS.find((x) => x.value === order) ?? SORTS[0];
  if (dir === "auto") return s.note;
  const reversed: Record<SearchOrder, [string, string]> = {
    edhrec: ["most played first", "least played first"],
    usd: ["cheapest first", "most expensive first"],
    cmc: ["lowest mana value first", "highest mana value first"],
    name: ["A to Z", "Z to A"],
    released: ["oldest first", "newest first"],
    power: ["lowest power first", "highest power first"],
  };
  return reversed[order][dir === "asc" ? 0 : 1];
}

// ---------- examples and cheat sheet ----------

/** One-tap searches from the video, each a real Scryfall query. */
export const EXAMPLES: { label: string; query: string }[] = [
  { label: "Equipment that gives ward", query: "t:equipment o:ward" },
  { label: "Auras that give ward", query: "t:aura o:ward" },
  { label: "New cards since 2022", query: "is:firstprint year>=2022" },
  { label: "Creatures that deal damage", query: 't:creature o:"~ deals"' },
  { label: "Cheap removal", query: "otag:removal mv<=2" },
  { label: "Not on the Reserved List, under $5", query: "-is:reserved usd<=5" },
];

export const CHEAT_SHEET: { syntax: string; means: string }[] = [
  { syntax: "t:creature", means: "Type or subtype (t:elf, t:equipment)" },
  { syntax: 'o:"draw a card"', means: "Rules text contains (~ = the card's own name)" },
  { syntax: "c>=wu / c<=wu / c=wu", means: "Colors: including, at most, exactly" },
  { syntax: "id<=bg", means: "Color identity (added for you from the commander)" },
  { syntax: "mv<=3", means: "Mana value (also =, >, >=, <)" },
  { syntax: "usd<=5", means: "Price in US dollars" },
  { syntax: "kw:flying", means: "Has a keyword" },
  { syntax: "s:dsk / year>=2022", means: "Set code / year printed" },
  { syntax: "is:firstprint", means: "First printing only (no reprints)" },
  { syntax: "otag:ramp / art:dragon", means: "Scryfall Tagger function and art tags" },
  { syntax: "-is:reserved", means: "A minus sign excludes anything" },
  { syntax: "t:aura or t:equipment", means: "Either one (use parentheses to group)" },
];
