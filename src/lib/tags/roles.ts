// Roles, ported from the prototype's STANDARD_ROLES / resolveRoles / rolesOf.
// Each role is a set of tag slugs plus all their descendants; Lands come from the type line.
// The seven slugs that don't exist in Scryfall's data were dropped (CLAUDE.md, Phase 3 plan).
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import type { TagTree } from "./tree";

export type RoleDef = {
  key: string;
  name: string;
  target: number;
  /** Tag slugs; each includes its whole subtree. Absent for Lands. */
  slugs?: string[];
  land?: boolean;
  /** A card in this other role doesn't count here (targeted removal excludes board wipes). */
  exclude?: string;
  custom?: boolean;
};

export const STANDARD_ROLES: RoleDef[] = [
  { key: "lands", name: "Lands", target: DEFAULT_ROLE_TARGETS.lands, land: true },
  { key: "ramp", name: "Ramp", target: DEFAULT_ROLE_TARGETS.ramp, slugs: ["ramp", "mana-rock", "mana-dork", "land-ramp"] },
  { key: "draw", name: "Card advantage", target: DEFAULT_ROLE_TARGETS.draw, slugs: ["card-advantage", "draw"] },
  {
    key: "removal",
    name: "Targeted removal",
    target: DEFAULT_ROLE_TARGETS.removal,
    slugs: ["removal", "spot-removal"],
    exclude: "wipes",
  },
  { key: "wipes", name: "Board wipes", target: DEFAULT_ROLE_TARGETS.wipes, slugs: ["sweeper"] },
  {
    key: "protection",
    name: "Protection",
    target: DEFAULT_ROLE_TARGETS.protection,
    slugs: ["protection", "gives-protection", "protects-permanent", "gives-hexproof", "gives-indestructible"],
  },
  { key: "recursion", name: "Recursion", target: DEFAULT_ROLE_TARGETS.recursion, slugs: ["recursion"] },
];

export type ResolvedRole = RoleDef & { tagSet: Set<string> | null; missing: string[] };

/** Expands each role's slugs to their full subtrees. Slugs not in the data are reported, not fatal. */
export function resolveRoles(roles: RoleDef[], tree: TagTree): ResolvedRole[] {
  return roles.map((r) => {
    if (r.land || !r.slugs) return { ...r, tagSet: null, missing: [] };
    const found = r.slugs.filter((s) => tree.has(s));
    return { ...r, tagSet: tree.descendants(found), missing: r.slugs.filter((s) => !tree.has(s)) };
  });
}

/** A land by its front face (modal double-faced spell // land cards count as their front, like the type groups). */
export function isLand(typeLine: string) {
  return /\bLand\b/.test(typeLine.split(" // ")[0]);
}

/** The roles a card fills, in role order. A land fills only Lands, as in the prototype. */
export function rolesOf(typeLine: string, slugs: string[] | undefined, roles: ResolvedRole[]): string[] {
  if (isLand(typeLine)) return roles.some((r) => r.land) ? [roles.find((r) => r.land)!.key] : [];
  const tags = slugs ?? [];
  const filled = new Set<string>();
  for (const r of roles) {
    if (r.tagSet && tags.some((t) => r.tagSet!.has(t))) filled.add(r.key);
  }
  for (const r of roles) if (r.exclude && filled.has(r.exclude)) filled.delete(r.key);
  return roles.filter((r) => filled.has(r.key)).map((r) => r.key);
}
