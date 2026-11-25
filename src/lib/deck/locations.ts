// Binders and boxes (v2, migration 0067): where your copies are, and how each binder looks.
// Each location has a kind and a style the owner sets (color, cover card, layout, pocket size, card size, sort,
// texture). The style is one jsonb value read here, so a new style field needs no migration: add it to
// LocationStyle, give it a default in readLocationStyle, and the page can use it.
// Pure helpers; the hook is use-locations.ts and the page is src/app/collection/collection-view.tsx.
import type { OwnedRow } from "./collection";
import type { CollectionGroup, CollectionSort } from "./collection-view";

export type LocationKind = "binder" | "box" | "deckbox" | "other";
export const LOCATION_KINDS: Record<LocationKind, { label: string; icon: string }> = {
  binder: { label: "Binder", icon: "📒" },
  box: { label: "Box", icon: "📦" },
  deckbox: { label: "Deck box", icon: "🗃" },
  other: { label: "Other", icon: "📍" },
};

/** Binder pages show pockets like a real binder; the rest are the collection's usual views. */
export type LocationLayout = "pages" | "grid" | "stacks" | "text";
export const LAYOUT_LABELS: Record<LocationLayout, string> = { pages: "Binder pages", grid: "Visual grid", stacks: "Stacks", text: "Text" };
/** Pockets per page: columns × rows. */
export const POCKETS = { "2x2": [2, 2], "3x3": [3, 3], "4x3": [4, 3] } as const;
export type PocketSize = keyof typeof POCKETS;
export type CardSize = "small" | "medium" | "large";
export const CARD_SIZE_LABELS: Record<CardSize, string> = { small: "Small", medium: "Medium", large: "Large" };
export type Texture = "leather" | "canvas" | "plain";
export const TEXTURE_LABELS: Record<Texture, string> = { leather: "Leather", canvas: "Canvas", plain: "Plain" };

/** Binder colors: hand-picked so text on them reads in both looks. */
export const LOCATION_COLORS = ["#b8892f", "#8c2f39", "#2f5d8c", "#2f7a56", "#5b3f8c", "#3b3b3b", "#a4552a", "#2f7f86"] as const;

export type LocationCover = { oracle_id: string; printing_id: string | null; image_v?: string | null; artist?: string | null };

export type LocationStyle = {
  color: string;
  cover: LocationCover | null;
  layout: LocationLayout;
  pockets: PocketSize;
  size: CardSize;
  sort: CollectionSort;
  group: CollectionGroup;
  texture: Texture;
  /** Short line under the name (what's in it, where it sits on the shelf). */
  note: string;
};

export type CollectionLocation = { id: string; name: string; kind: LocationKind; style: LocationStyle; sort: number };

const HEX = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f-]{36}$/i;
export const NOTE_MAX = 80;
export const NAME_MAX = 40;

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback);

export function defaultStyle(kind: LocationKind = "binder", index = 0): LocationStyle {
  return {
    color: LOCATION_COLORS[index % LOCATION_COLORS.length],
    cover: null,
    layout: kind === "binder" ? "pages" : "grid",
    pockets: "3x3",
    size: "medium",
    sort: kind === "binder" ? "set" : "name",
    group: "none",
    texture: kind === "binder" ? "leather" : "plain",
    note: "",
  };
}

/** A stored style with anything unknown or broken replaced by the default for that kind. */
export function readLocationStyle(raw: unknown, kind: LocationKind = "binder"): LocationStyle {
  const d = defaultStyle(kind);
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const c = r.cover as Record<string, unknown> | null | undefined;
  const cover: LocationCover | null =
    c && typeof c === "object" && typeof c.oracle_id === "string" && UUID.test(c.oracle_id)
      ? {
          oracle_id: c.oracle_id,
          printing_id: typeof c.printing_id === "string" && UUID.test(c.printing_id) ? c.printing_id : null,
          image_v: typeof c.image_v === "string" ? c.image_v : null,
          artist: typeof c.artist === "string" ? c.artist : null,
        }
      : null;
  return {
    color: typeof r.color === "string" && HEX.test(r.color) ? r.color : d.color,
    cover,
    layout: pick(r.layout, Object.keys(LAYOUT_LABELS) as LocationLayout[], d.layout),
    pockets: pick(r.pockets, Object.keys(POCKETS) as PocketSize[], d.pockets),
    size: pick(r.size, Object.keys(CARD_SIZE_LABELS) as CardSize[], d.size),
    sort: pick(r.sort, ["name", "price", "set", "added"] as CollectionSort[], d.sort),
    group: pick(r.group, ["none", "set", "type", "color"] as CollectionGroup[], d.group),
    texture: pick(r.texture, Object.keys(TEXTURE_LABELS) as Texture[], d.texture),
    note: typeof r.note === "string" ? r.note.slice(0, NOTE_MAX) : "",
  };
}

export function readLocations(rows: unknown): CollectionLocation[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .flatMap((x) => {
      const r = x as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.name !== "string") return [];
      const kind = pick(r.kind, Object.keys(LOCATION_KINDS) as LocationKind[], "other");
      return [{ id: r.id, name: r.name, kind, style: readLocationStyle(r.style, kind), sort: typeof r.sort === "number" ? r.sort : 0 }];
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

/** Null when the name is fine, else why not. Names are unique per person, ignoring case. */
export function locationNameProblem(name: string, others: CollectionLocation[], selfId?: string): string | null {
  const n = name.trim();
  if (!n) return "Give it a name.";
  if (n.length > NAME_MAX) return `Keep the name to ${NAME_MAX} characters.`;
  if (n.toLowerCase() === "unsorted" || n.toLowerCase() === "all") return `“${n}” is taken by the collection itself.`;
  if (others.some((o) => o.id !== selfId && o.name.trim().toLowerCase() === n.toLowerCase())) return "You already have one with that name.";
  return null;
}

/** "all" = every row, "unsorted" = rows in no location, else one location id. */
export type LocationView = "all" | "unsorted" | string;

export const rowsIn = (rows: OwnedRow[], view: LocationView) =>
  view === "all" ? rows : view === "unsorted" ? rows.filter((r) => !r.location_id) : rows.filter((r) => r.location_id === view);

/** Copies per location id ("" = Unsorted). */
export function copiesByLocation(rows: OwnedRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.location_id ?? "", (out.get(r.location_id ?? "") ?? 0) + r.quantity);
  return out;
}

/** The location a new copy goes into while this view is open: the location itself, else Unsorted. */
export const locationForAdds = (view: LocationView): string | null => (view === "all" || view === "unsorted" ? null : view);

/**
 * Moving `count` copies of one row to another location: the source row shrinks (0 deletes it) and the row already
 * at the destination grows. Returns the two quantity changes for useCollection.setMany.
 */
export function planMove(rows: OwnedRow[], from: OwnedRow, to: string | null, count = from.quantity) {
  const n = Math.max(0, Math.min(from.quantity, Math.round(count)));
  if (n === 0 || (from.location_id ?? null) === to) return [];
  const dest = { ...from, location_id: to };
  const there = rows.find(
    (r) => r.oracle_id === from.oracle_id && r.printing_id === from.printing_id && r.finish === from.finish && (r.location_id ?? null) === to,
  );
  return [
    { target: from, quantity: from.quantity - n },
    { target: dest, quantity: Math.min(9999, (there?.quantity ?? 0) + n) },
  ];
}

/** Rows to take copies from when removing `n` copies of a printing without naming a location: Unsorted first. */
export function removalOrder(rows: OwnedRow[]): OwnedRow[] {
  return [...rows].sort((a, b) => Number(!!a.location_id) - Number(!!b.location_id) || a.quantity - b.quantity);
}

/** Splits items into binder pages of cols × rows pockets. */
export function binderPages<T>(items: T[], pockets: PocketSize): T[][] {
  const [c, r] = POCKETS[pockets];
  const per = c * r;
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += per) pages.push(items.slice(i, i + per));
  return pages.length ? pages : [[]];
}

/**
 * Changes that add (delta > 0) or take away (delta < 0) copies of one printing and finish. Adds go to `location`;
 * removals come from that location when given, else Unsorted first, then the smallest piles.
 */
export function deltaChanges(rows: OwnedRow[], target: Omit<OwnedRow, "quantity">, delta: number, location: string | null | undefined) {
  const same = rows.filter((r) => r.oracle_id === target.oracle_id && r.printing_id === target.printing_id && r.finish === target.finish);
  if (delta > 0) {
    const to = location ?? null;
    const there = same.find((r) => (r.location_id ?? null) === to);
    return [{ target: { ...target, location_id: to }, quantity: Math.min(9999, (there?.quantity ?? 0) + delta) }];
  }
  let left = -delta;
  const out: { target: OwnedRow; quantity: number }[] = [];
  const from = location !== undefined ? same.filter((r) => (r.location_id ?? null) === location) : removalOrder(same);
  for (const r of from) {
    if (left <= 0) break;
    const take = Math.min(left, r.quantity);
    out.push({ target: r, quantity: r.quantity - take });
    left -= take;
  }
  return out;
}
