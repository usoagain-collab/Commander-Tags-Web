// Role subgroups (step 3e): with Group by Role, each role splits into sub-groups from the tag tree,
// e.g. Ramp › Mana rock, Mana dork, Land ramp. (Archidekt's subcategories request, docs/spec.md.)
import type { ResolvedRole } from "./roles";
import type { TagTree } from "./tree";

/**
 * Which subgroups a card could go in for a role, from each of its tags in that role:
 * - if the tag sits under one of the role's own named tags beyond the first (Ramp's mana-rock, mana-dork,
 *   land-ramp; Card advantage's draw), that named tag;
 * - otherwise the first branch below the role's main tag (or the main tag itself if the card is tagged there).
 */
export function subgroupCandidates(tags: string[], role: ResolvedRole, tree: TagTree): string[] {
  if (!role.tagSet || !role.slugs?.length) return [];
  const named = new Set(role.slugs.slice(1));
  const out = new Set<string>();
  for (const t of tags) {
    if (!role.tagSet.has(t)) continue;
    const chain = tree.chain(t).filter((s) => role.tagSet!.has(s));
    const namedInChain = chain.filter((s) => named.has(s));
    if (namedInChain.length) out.add(namedInChain.at(-1)!);
    else out.add(chain[1] ?? chain[0] ?? t);
  }
  return [...out];
}

/**
 * Picks one subgroup per card: the candidate shared by the most cards in this role (ties: alphabetical), so
 * groups stay meaningful instead of scattering. Subgroups left with a single card return null ("Other").
 * Returns an empty map when splitting wouldn't help (fewer than two real subgroups).
 */
export function assignSubgroups(items: { id: string; candidates: string[] }[]): Map<string, string | null> {
  const popularity = new Map<string, number>();
  for (const it of items) for (const c of it.candidates) popularity.set(c, (popularity.get(c) ?? 0) + 1);

  const choice = new Map<string, string | null>();
  for (const it of items) {
    const best = [...it.candidates].sort((a, b) => (popularity.get(b)! - popularity.get(a)!) || a.localeCompare(b))[0];
    choice.set(it.id, best ?? null);
  }
  const size = new Map<string, number>();
  for (const g of choice.values()) if (g) size.set(g, (size.get(g) ?? 0) + 1);
  for (const [id, g] of choice) if (g && size.get(g)! < 2) choice.set(id, null);

  const real = new Set([...choice.values()].filter((g): g is string => !!g));
  return real.size >= 2 ? choice : new Map();
}

/** Lands split by kind rather than by tag (lands mostly have no function tags). */
export function landSubgroup(card: { type_line: string; counts_as_land?: boolean }): { key: string; title: string } {
  const front = card.type_line.split(" // ")[0];
  if (!/\bLand\b/.test(front)) return { key: "mdfc", title: "MDFCs" };
  return /\bBasic\b/.test(front) ? { key: "basic", title: "Basic lands" } : { key: "nonbasic", title: "Nonbasic lands" };
}

/** "mana-rock" -> "Mana rock" for subgroup headings. */
export function subgroupTitle(slug: string, tree: TagTree) {
  const s = tree.label(slug).replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
