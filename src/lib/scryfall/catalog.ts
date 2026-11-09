// Scryfall's catalogs for search autocomplete (v2, Nov 8, 2026): card types and subtypes after t:, keywords after
// kw:, set codes after s:. Fetched from the browser (CORS allowed) the first time each list is needed, kept for the
// visit. Our database has tags but not these lists.

export type CatalogKind = "type" | "keyword" | "set";
export type CatalogItem = { value: string; hint?: string };

const API = "https://api.scryfall.com";
const TYPE_CATALOGS = ["card-types", "supertypes", "creature-types", "artifact-types", "enchantment-types", "land-types", "spell-types", "planeswalker-types", "battle-types"];
const KEYWORD_CATALOGS = ["keyword-abilities", "keyword-actions", "ability-words"];
const HINTS: Record<string, string> = {
  "card-types": "card type",
  supertypes: "supertype",
  "creature-types": "creature type",
  "artifact-types": "artifact type",
  "enchantment-types": "enchantment type",
  "land-types": "land type",
  "spell-types": "spell type",
  "planeswalker-types": "planeswalker type",
  "battle-types": "battle type",
  "keyword-abilities": "keyword",
  "keyword-actions": "keyword action",
  "ability-words": "ability word",
};

const cache = new Map<CatalogKind, Promise<CatalogItem[]>>();

async function catalog(name: string): Promise<string[]> {
  const res = await fetch(`${API}/catalog/${name}`, { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  return ((await res.json()).data ?? []) as string[];
}

async function load(kind: CatalogKind): Promise<CatalogItem[]> {
  if (kind === "set") {
    const res = await fetch(`${API}/sets`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Scryfall sets: ${res.status}`);
    const sets = ((await res.json()).data ?? []) as { code: string; name: string; digital: boolean; released_at?: string }[];
    return sets.filter((s) => !s.digital).map((s) => ({ value: s.code, hint: `${s.name}${s.released_at ? ` · ${s.released_at.slice(0, 4)}` : ""}` }));
  }
  const names = kind === "type" ? TYPE_CATALOGS : KEYWORD_CATALOGS;
  const lists = await Promise.all(names.map(catalog));
  const seen = new Set<string>();
  const out: CatalogItem[] = [];
  lists.forEach((list, i) => {
    for (const v of list) {
      if (seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      out.push({ value: v, hint: HINTS[names[i]] });
    }
  });
  return out;
}

/** The whole list for a kind (fetched once per visit; a failed fetch is retried next time). */
export function loadCatalog(kind: CatalogKind): Promise<CatalogItem[]> {
  let p = cache.get(kind);
  if (!p) {
    p = load(kind).catch((e) => {
      cache.delete(kind);
      throw e;
    });
    cache.set(kind, p);
  }
  return p;
}

/** Best matches for what's typed: exact, then starts with it, then a word starts with it, then anywhere. */
export function matchCatalog(items: CatalogItem[], partial: string, limit = 8): CatalogItem[] {
  const p = partial.toLowerCase();
  const rank = (v: string) => {
    const s = v.toLowerCase();
    if (s === p) return 0;
    if (s.startsWith(p)) return 1;
    if (s.split(/[\s-]/).some((w) => w.startsWith(p))) return 2;
    return s.includes(p) ? 3 : 9;
  };
  return items
    .map((it) => ({ it, r: rank(it.value) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r || a.it.value.length - b.it.value.length || a.it.value.localeCompare(b.it.value))
    .slice(0, limit)
    .map((x) => x.it);
}
