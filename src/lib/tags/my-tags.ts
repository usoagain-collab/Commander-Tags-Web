// My tags (step 3f): your own labels on cards. Account-wide tags (deck_id null) follow their cards into every
// deck; deck tags (deck_id set) belong to one deck. Stored in user_tags / user_tag_cards (migration 0009).
import type { TagCards } from "@/lib/deck/model";

export const MY_TAG_COLORS = ["slate", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink"] as const;
export type MyTagColor = (typeof MY_TAG_COLORS)[number];
export type MyTag = { id: string; name: string; color: MyTagColor; deck_id: string | null };
export type MyTagScope = "deck" | "account";

/** Chip colors. Written out in full so Tailwind keeps every class. */
export const MY_TAG_CHIP: Record<MyTagColor, string> = {
  slate: "bg-slate-500/20 text-slate-800 dark:text-slate-200",
  red: "bg-red-500/20 text-red-800 dark:text-red-300",
  orange: "bg-orange-500/20 text-orange-800 dark:text-orange-300",
  amber: "bg-amber-500/25 text-amber-900 dark:text-amber-300",
  green: "bg-green-600/20 text-green-800 dark:text-green-300",
  teal: "bg-teal-500/20 text-teal-800 dark:text-teal-300",
  blue: "bg-blue-500/20 text-blue-800 dark:text-blue-300",
  violet: "bg-violet-500/20 text-violet-800 dark:text-violet-300",
  pink: "bg-pink-500/20 text-pink-800 dark:text-pink-300",
};
/** Solid swatches for the color picker. */
export const MY_TAG_SWATCH: Record<MyTagColor, string> = {
  slate: "bg-slate-500",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  green: "bg-green-600",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};

export const scopeOf = (t: MyTag): MyTagScope => (t.deck_id ? "deck" : "account");
export const myTagHighlight = (id: string) => `my:${id}`;

/** Tags as they come from my_tags_for(), checked (the color list could change). */
export function readMyTags(raw: unknown): { tags: MyTag[]; cards: TagCards } {
  const r = (raw ?? {}) as { tags?: unknown; cards?: unknown };
  const tags = (Array.isArray(r.tags) ? r.tags : []).flatMap((t): MyTag[] => {
    const x = t as Partial<MyTag>;
    if (typeof x.id !== "string" || typeof x.name !== "string") return [];
    const color = MY_TAG_COLORS.includes(x.color as MyTagColor) ? (x.color as MyTagColor) : "slate";
    return [{ id: x.id, name: x.name, color, deck_id: typeof x.deck_id === "string" ? x.deck_id : null }];
  });
  const ids = new Set(tags.map((t) => t.id));
  const cards: TagCards = {};
  for (const [oracle, list] of Object.entries((r.cards ?? {}) as Record<string, unknown>)) {
    const keep = (Array.isArray(list) ? list : []).filter((id): id is string => typeof id === "string" && ids.has(id));
    if (keep.length) cards[oracle] = keep;
  }
  return { tags: sortMyTags(tags), cards };
}

export const sortMyTags = (tags: MyTag[]) => [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

/**
 * Why a name can't be used, or null if it's fine. Names are unique per scope (the database enforces that too),
 * and a deck tag may not share a name with an account-wide one, which would show two identical chips.
 */
export function nameProblem(name: string, tags: MyTag[], exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return "Give the tag a name.";
  if (n.length > 40) return "Keep tag names to 40 characters.";
  const clash = tags.find((t) => t.id !== exceptId && t.name.trim().toLowerCase() === n.toLowerCase());
  return clash ? `You already have a tag called "${clash.name}".` : null;
}

/** The next color nobody uses yet (cycles once all are taken), so new tags look different by default. */
export function nextColor(tags: MyTag[]): MyTagColor {
  const used = new Map<MyTagColor, number>();
  for (const t of tags) used.set(t.color, (used.get(t.color) ?? 0) + 1);
  const order: MyTagColor[] = [...MY_TAG_COLORS.filter((c) => c !== "slate"), "slate"];
  return [...order].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0];
}

/** A card's tags in list order (alphabetical). */
export function tagsOfCard(tagCards: TagCards, oracleId: string, tags: MyTag[]): MyTag[] {
  const on = new Set(tagCards[oracleId] ?? []);
  return tags.filter((t) => on.has(t.id));
}
