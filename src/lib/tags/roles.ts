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
  /**
   * If the card also fills `role`, these tags (and their sub-tags) don't count toward this one. Used so
   * "put lands from your library onto the battlefield" effects, which Scryfall files under card advantage,
   * count as Ramp only, while ramp cards that really draw still count for both (David, Oct 19, 2026).
   */
  notVia?: { role: string; slugs: string[] };
  /** Plain-language explanation for the role's info icon. */
  about?: string;
  custom?: boolean;
};

export const STANDARD_ROLES: RoleDef[] = [
  {
    key: "lands",
    name: "Lands",
    target: DEFAULT_ROLE_TARGETS.lands,
    land: true,
    about:
      "Cards you can play as a land: anything with Land on its front face, plus modal double-faced cards with a land face (like Sink into Stupor // Soporific Springs). Cards that only transform into a land don't count.",
  },
  {
    key: "ramp",
    name: "Ramp",
    target: DEFAULT_ROLE_TARGETS.ramp,
    slugs: ["ramp", "mana-rock", "mana-dork", "land-ramp"],
    about: "Cards that get you extra mana or extra lands. Lands themselves count under Lands, not here.",
  },
  {
    key: "draw",
    name: "Card advantage",
    target: DEFAULT_ROLE_TARGETS.draw,
    slugs: ["card-advantage", "draw"],
    notVia: { role: "ramp", slugs: ["consult-onto-battlefield", "impulse-onto-battlefield", "impulse-land", "land-or-hand"] },
    about:
      "Cards that draw or otherwise get you extra cards: draw engines, cantrips, impulse draw and so on. Ramp cards that just put lands from your library onto the battlefield count as Ramp only; ramp cards that also draw count here too.",
  },
  {
    key: "removal",
    name: "Targeted removal",
    target: DEFAULT_ROLE_TARGETS.removal,
    slugs: ["removal", "spot-removal"],
    exclude: "wipes",
    about: "Cards that remove a specific permanent or spell. Board wipes are counted under Board wipes instead.",
  },
  {
    key: "wipes",
    name: "Board wipes",
    target: DEFAULT_ROLE_TARGETS.wipes,
    slugs: ["sweeper"],
    about: "Cards that destroy, exile or bounce many permanents at once.",
  },
  {
    key: "protection",
    name: "Protection",
    target: DEFAULT_ROLE_TARGETS.protection,
    slugs: ["protection", "gives-protection", "protects-permanent", "gives-hexproof", "gives-indestructible"],
    about: "Cards that protect your permanents: hexproof, indestructible, protection and similar.",
  },
  {
    key: "recursion",
    name: "Recursion",
    target: DEFAULT_ROLE_TARGETS.recursion,
    slugs: ["recursion"],
    about: "Cards that get cards back from your graveyard: reanimation, regrowth and similar.",
  },
];

export type ResolvedRole = RoleDef & { tagSet: Set<string> | null; missing: string[]; notViaSet?: Set<string> };

/** Expands each role's slugs to their full subtrees. Slugs not in the data are reported, not fatal. */
export function resolveRoles(roles: RoleDef[], tree: TagTree): ResolvedRole[] {
  return roles.map((r) => {
    if (r.land || !r.slugs) return { ...r, tagSet: null, missing: [] };
    const found = r.slugs.filter((s) => tree.has(s));
    return {
      ...r,
      tagSet: tree.descendants(found),
      missing: r.slugs.filter((s) => !tree.has(s)),
      notViaSet: r.notVia ? tree.descendants(r.notVia.slugs.filter((s) => tree.has(s))) : undefined,
    };
  });
}

/** A land by its front face: used for the type groups and to tell pure lands from spell // land MDFCs. */
export function isLand(typeLine: string) {
  return /\bLand\b/.test(typeLine.split(" // ")[0]);
}

/** What rolesOf needs to know about a card. counts_as_land comes from the card_summaries view. */
export type RoleCard = { type_line: string; counts_as_land?: boolean };

/**
 * The roles a card fills, in role order.
 * - A land (front face) fills only Lands, as in the prototype.
 * - A modal double-faced card with a land face fills Lands AND its spell roles: Sink into Stupor //
 *   Soporific Springs is both removal and a land drop (David, Oct 18, 2026).
 */
export function rolesOf(card: RoleCard, slugs: string[] | undefined, roles: ResolvedRole[]): string[] {
  const landRole = roles.find((r) => r.land);
  if (isLand(card.type_line)) return landRole ? [landRole.key] : [];
  const tags = slugs ?? [];
  const filled = new Set<string>();
  if (card.counts_as_land && landRole) filled.add(landRole.key);
  for (const r of roles) {
    if (r.tagSet && tags.some((t) => r.tagSet!.has(t))) filled.add(r.key);
  }
  for (const r of roles) if (r.exclude && filled.has(r.exclude)) filled.delete(r.key);
  // notVia: when the card also fills that other role, the listed tags alone don't qualify it for this one.
  for (const r of roles) {
    if (!r.notVia || !r.notViaSet || !filled.has(r.key) || !filled.has(r.notVia.role)) continue;
    const otherTags = tags.filter((t) => r.tagSet!.has(t) && !r.notViaSet!.has(t));
    if (otherTags.length === 0) filled.delete(r.key);
  }
  return roles.filter((r) => filled.has(r.key)).map((r) => r.key);
}
