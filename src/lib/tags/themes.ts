// The top-tags panel (Phase 3d), ported from the prototype's themeTags / themeOk / isFlavorOracle / showTree.
//
// A theme tag is any tag that isn't part of a role. Count it across the deck's nonland cards (the commander
// counts double and its tags are pinned at the top), keep tags on 2+ cards, and score them so rare tags
// beat common ones: score = count × ln(1 + N / tag size), where N is the number of tagged cards.
import { TagTree, type TagTreePayload } from "./tree";

export type ThemeMode = "gameplay" | "flavor";
export type ThemeSort = "relevance" | "count";
export type ThemeSettings = { mode: ThemeMode; specific: boolean; sortBy: ThemeSort };
export const DEFAULT_THEME_SETTINGS: ThemeSettings = { mode: "gameplay", specific: true, sortBy: "relevance" };

/** Saved under profiles.tag_view as tagMode / tagSpecific / tagSort (next to the View / Group / Sort keys). */
export function readThemeSettings(saved: unknown): ThemeSettings {
  const s = (saved ?? {}) as Record<string, unknown>;
  return {
    mode: s.tagMode === "flavor" ? "flavor" : "gameplay",
    specific: s.tagSpecific === false ? false : true,
    sortBy: s.tagSort === "count" ? "count" : "relevance",
  };
}
export const themeSettingsToSaved = (t: ThemeSettings) => ({ tagMode: t.mode, tagSpecific: t.specific, tagSort: t.sortBy });

/** Oracle tags that describe how a card is built, not what it does: never a theme. */
export const MECHANIC_NOISE = new Set([
  "static ability",
  "keyword ability",
  "mana ability",
  "virtual vanilla",
  "vanilla",
  "french vanilla",
  "reminder text",
  // Too vague to be a theme: rare enough to weigh a lot, but they say little about what a deck does. They made
  // Hidden gems suggest filler in the Phase 4c EDHREC check (David, Oct 19, 2026).
  "unique type line",
  "multiple targets",
  "attacking matters self",
  "repeatable crime",
  "per player",
  "donate token",
  // Ability kinds, like static/keyword/mana ability above: nearly every card has one. With the vague tags gone
  // they rose to the top themes and drove the picks (City of Brass, Chrome Mox) in the same check.
  "activated ability",
  "triggered ability",
]);
/** Oracle tags about names, wording and frame: not gameplay, so they belong with Flavor. */
export const FLAVOR_ORACLE = new Set(["single english word name", "alliteration", "flavor name", "color break", "illustrated"]);
/** An art tag on more than 4% of illustrations is too broad to be a theme. */
export const GENERIC_SHARE = 0.04;
/** How many tags the panel shows. */
export const THEME_LIMIT = 24;

export const normLabel = (l: string) => l.toLowerCase().replace(/[-_]+/g, " ").trim();

export function isFlavorOracle(tag: { slug: string; label: string }) {
  const l = normLabel(tag.label);
  const s = normLabel(tag.slug);
  return FLAVOR_ORACLE.has(l) || FLAVOR_ORACLE.has(s) || /\bflavor\b|english word|alliteration|\bpun\b/.test(l);
}

/** Tag keys: "o:<slug>" for oracle tags, "a:<slug>" for art tags (also how hidden tags are stored). */
export type TagKey = string;
export const oKey = (slug: string) => `o:${slug}`;
export const aKey = (slug: string) => `a:${slug}`;
export const splitKey = (key: TagKey) => ({ kind: key[0] as "o" | "a", slug: key.slice(2) });

/** One card as the panel sees it. */
export type ThemeCard = { oracle: string[]; art: string[]; commander: boolean; land: boolean };

export type ThemeTag = {
  key: TagKey;
  kind: "o" | "a";
  slug: string;
  label: string;
  size: number;
  count: number;
  pinned: boolean;
  score: number;
  depth: number;
};

type Trees = { oracle: TagTree; art: TagTree | null };
const treeFor = (key: TagKey, t: Trees) => (key[0] === "a" ? t.art : t.oracle);

/** Should this tag count as a theme in this mode? (prototype: themeOk) */
export function themeOk(key: TagKey, mode: ThemeMode, trees: Trees, hidden: Set<string>): boolean {
  const { kind, slug } = splitKey(key);
  const info = treeFor(key, trees)?.info(slug);
  if (!info || hidden.has(key)) return false;
  if (kind === "a") return mode === "flavor" && info.size <= (trees.art?.artN ?? 0) * GENERIC_SHARE;
  if (slug.startsWith("cycle-") || slug.startsWith("reprint")) return false;
  if (MECHANIC_NOISE.has(normLabel(info.label)) || MECHANIC_NOISE.has(normLabel(slug))) return false;
  const flavor = isFlavorOracle(info);
  // No size cutoff for gameplay tags: the Specific/Broad switch and the rarity weighting handle broad tags.
  return mode === "flavor" ? flavor : !flavor;
}

/** A card's tag keys: exactly as applied (Specific), or also every ancestor (Broad). */
export function cardKeys(card: ThemeCard, specific: boolean, trees: Trees): TagKey[] {
  const keys = [...card.oracle.map(oKey), ...card.art.map(aKey)];
  if (specific) return keys;
  const out = new Set(keys);
  for (const s of card.oracle) for (const a of trees.oracle.ancestors(s)) out.add(oKey(a));
  if (trees.art) for (const s of card.art) for (const a of trees.art.ancestors(s)) out.add(aKey(a));
  return [...out];
}

/** The ranked theme tags for a deck (prototype: themeTags). */
export function themeTags(
  cards: ThemeCard[],
  opts: { settings: ThemeSettings; trees: Trees; roleTags: Set<string>; hidden: Set<string>; limit?: number },
): ThemeTag[] {
  const { settings, trees, roleTags, hidden } = opts;
  const count = new Map<TagKey, number>();
  const pinned = new Set<TagKey>();
  for (const card of cards) {
    if (card.land) continue;
    for (const key of cardKeys(card, settings.specific, trees)) {
      if (key[0] === "o" && roleTags.has(key.slice(2))) continue;
      if (!themeOk(key, settings.mode, trees, hidden)) continue;
      count.set(key, (count.get(key) ?? 0) + (card.commander ? 2 : 1));
      if (card.commander) pinned.add(key);
    }
  }

  const out: ThemeTag[] = [];
  for (const [key, c] of count) {
    if (c < 2 && !pinned.has(key)) continue;
    const { kind, slug } = splitKey(key);
    const tree = treeFor(key, trees)!;
    const info = tree.info(slug)!;
    const n = kind === "a" ? tree.artN : tree.n;
    const size = Math.max(1, info.size);
    out.push({
      key,
      kind,
      slug,
      label: info.label,
      size: info.size,
      count: c,
      pinned: pinned.has(key),
      score: c * Math.log(1 + n / size),
      depth: tree.depth(slug),
    });
  }
  const byPin = (a: ThemeTag, b: ThemeTag) => Number(b.pinned) - Number(a.pinned);
  out.sort(
    (a, b) =>
      byPin(a, b) ||
      (settings.sortBy === "count" ? b.count - a.count || b.score - a.score : b.score - a.score) ||
      a.label.localeCompare(b.label),
  );
  const top = out.slice(0, opts.limit ?? THEME_LIMIT);
  // Specific lists the deepest tags first within the chosen top tags (stable sort keeps the Sort order per depth).
  if (settings.specific) top.sort((a, b) => byPin(a, b) || b.depth - a.depth);
  return top;
}

/** In-deck counts for every applied tag key (each card once), for the tag tree card. */
export function deckKeyCounts(cards: ThemeCard[]): Map<TagKey, number> {
  const m = new Map<TagKey, number>();
  for (const card of cards) for (const key of [...card.oracle.map(oKey), ...card.art.map(aKey)]) m.set(key, (m.get(key) ?? 0) + 1);
  return m;
}

export type TreeCardRow = { key: TagKey; label: string; count: number; depth: number; self?: boolean };
export type TreeCard = { kind: "o" | "a"; rows: TreeCardRow[]; moreChildren: number; size: number };

/** The hover card: parents, the tag (highlighted), then up to 8 sub-tags, with in-deck counts (prototype: showTree). */
export function treeCard(key: TagKey, trees: Trees, counts: Map<TagKey, number>, maxChildren = 8): TreeCard | null {
  const { kind, slug } = splitKey(key);
  const tree = treeFor(key, trees);
  const info = tree?.info(slug);
  if (!tree || !info) return null;
  const k = (s: string) => (kind === "a" ? aKey(s) : oKey(s));
  const chain = tree.chain(slug);
  const rows: TreeCardRow[] = chain.map((s, d) => ({ key: k(s), label: tree.label(s), count: counts.get(k(s)) ?? 0, depth: d, self: s === slug }));
  const kids = tree
    .childrenOf(slug)
    .map((s) => ({ key: k(s), label: tree.label(s), count: counts.get(k(s)) ?? 0, depth: chain.length }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { kind, rows: [...rows, ...kids.slice(0, maxChildren)], moreChildren: Math.max(0, kids.length - maxChildren), size: info.size };
}

/** Builds a small TagTree from art_tag_ancestry's [[slug, label, size, [parent slugs]]] list. */
export function artTreeFrom(list: [string, string, number, string[]][], artN: number): TagTree {
  const pos = new Map(list.map(([s], i) => [s, i]));
  const payload: TagTreePayload = {
    n: artN,
    art_n: artN,
    tags: list.map(([s, label, size, parents]) => [s, label, size, parents.map((p) => pos.get(p)).filter((i): i is number => i !== undefined)]),
  };
  return new TagTree(payload);
}
