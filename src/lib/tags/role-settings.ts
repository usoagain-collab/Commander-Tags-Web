// Role targets and custom roles (Phase 3c). Saved with each deck (decks.role_targets / custom_roles);
// "Save as my defaults" copies them to the user's profile so new decks start from them.
import type { DeckLine } from "@/lib/deck/model";
import { STANDARD_ROLES, type RoleDef } from "./roles";

/** A role made from any oracle tag, e.g. { slug: "sacrifice-outlet", name: "Sac outlets", target: 6 }. */
export type CustomRole = { slug: string; name: string; target: number };

export const MAX_TARGET = 99;
export const customKey = (slug: string) => `c:${slug}`;

/** Saved targets, cleaned up: whole numbers between 0 and 99, unknown junk dropped. */
export function readTargets(saved: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (saved && typeof saved === "object") {
    for (const [k, v] of Object.entries(saved)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = Math.max(0, Math.min(MAX_TARGET, Math.round(n)));
    }
  }
  return out;
}

export function readCustomRoles(saved: unknown): CustomRole[] {
  if (!Array.isArray(saved)) return [];
  const seen = new Set<string>();
  return saved.flatMap((r) => {
    const slug = typeof r?.slug === "string" ? r.slug : "";
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    const target = Math.max(0, Math.min(MAX_TARGET, Math.round(Number(r.target) || 0)));
    return [{ slug, name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : slug, target }];
  });
}

/** The roles for a deck: the standard ones with this deck's targets, then its custom roles. */
export function buildRoleDefs(targets: Record<string, number>, custom: CustomRole[]): RoleDef[] {
  return [
    ...STANDARD_ROLES.map((r) => ({ ...r, target: targets[r.key] ?? r.target })),
    ...custom.map((c) => ({ key: customKey(c.slug), name: c.name, target: c.target, slugs: [c.slug], custom: true })),
  ];
}

/** How many cards in the deck fill each role (a card can count toward several). */
export function roleCounts(lines: DeckLine[], rolesOf: (line: DeckLine) => string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) for (const k of rolesOf(line)) counts[k] = (counts[k] ?? 0) + line.quantity;
  return counts;
}

export type RoleStatus = "under" | "met" | "over";
export function roleStatus(count: number, target: number): RoleStatus {
  return count < target ? "under" : count === target ? "met" : "over";
}

/** "need 3", "on target", "+2" */
export function statusText(count: number, target: number) {
  const s = roleStatus(count, target);
  return s === "under" ? `need ${target - count}` : s === "met" ? "on target" : `+${count - target}`;
}

/** A readable default name for a role made from a tag: "sacrifice-outlet" -> "Sacrifice outlet". */
export function roleNameFromLabel(label: string) {
  const s = label.replace(/[-_]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
