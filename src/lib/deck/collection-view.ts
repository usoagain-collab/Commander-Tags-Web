// The Collection page's items and sections (v2): each printing you own as its own item, or one item per card,
// grouped by set, type or color and sorted. Pure logic; the page is src/app/collection/collection-view.tsx.
import { rowUnitPrice, type OwnedRow } from "./collection";
import type { ViewMode } from "./grouping";
import { isLand } from "@/lib/tags/roles";
import { TYPE_DISPLAY_ORDER, typeSection, type CardSummary } from "./model";
import { printingImage } from "./printing";

export type CollectionGroup = "none" | "set" | "type" | "color";
export type CollectionSort = "name" | "price" | "set" | "added";
export type CollectionFilter = "all" | "foil" | "unknown";
export type CollectionPrefs = { view: ViewMode; group: CollectionGroup; sort: CollectionSort; perCard: boolean };

export const COLLECTION_GROUP_LABELS: Record<CollectionGroup, string> = { none: "None", set: "Set", type: "Type", color: "Color" };
export const COLLECTION_SORT_LABELS: Record<CollectionSort, string> = { name: "Name", price: "Price", set: "Set", added: "Newest" };
export const COLLECTION_FILTER_LABELS: Record<CollectionFilter, string> = { all: "All", foil: "Foil", unknown: "Printing unknown" };
const DEFAULT: CollectionPrefs = { view: "grid", group: "none", sort: "name", perCard: false };

/** profiles.tag_view.collection, with anything unknown replaced by the default. */
export function readCollectionPrefs(raw: unknown): CollectionPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, labels: Record<T, string>, fallback: T) => (typeof v === "string" && v in labels ? (v as T) : fallback);
  return {
    view: pick(r.view, { text: "", grid: "", stacks: "" }, DEFAULT.view),
    group: pick(r.group, COLLECTION_GROUP_LABELS, DEFAULT.group),
    sort: pick(r.sort, COLLECTION_SORT_LABELS, DEFAULT.sort),
    perCard: r.perCard === true,
  };
}

export type CollectionItem = {
  key: string;
  card: CardSummary;
  rows: OwnedRow[];
  quantity: number;
  /** Price of one copy (the most valuable row's, for a whole card) and of all copies. */
  unitPrice: number;
  value: number;
  image: string | null;
  foil: boolean;
  /** "CMR #472", "Printing unknown", or "3 printings". */
  label: string;
  added: string;
};

const setLabel = (r: OwnedRow) => (r.printing_info ? `${r.printing_info.set.toUpperCase()} #${r.printing_info.number}` : "Printing unknown");
const rowImage = (r: OwnedRow, card: CardSummary) => (r.printing_id ? printingImage(r.printing_id, "normal", "front", r.printing_info?.image_v) : card.image_normal);

/** Items to show: one per owned row, or one per card (its most-owned printing on top). Rows of unknown cards are left out. */
export function collectionItems(rows: OwnedRow[], cards: Record<string, CardSummary>, perCard: boolean, filter: CollectionFilter = "all"): CollectionItem[] {
  const kept = rows.filter((r) => cards[r.oracle_id] && (filter === "all" || (filter === "foil" ? r.finish !== "nonfoil" : !r.printing_id)));
  const make = (card: CardSummary, list: OwnedRow[], key: string): CollectionItem => {
    const top = [...list].sort((a, b) => b.quantity - a.quantity || Number(!!b.printing_id) - Number(!!a.printing_id))[0];
    const value = list.reduce((s, r) => s + r.quantity * rowUnitPrice(r, card.price_usd), 0);
    const printings = new Set(list.map((r) => r.printing_id ?? "?")).size;
    return {
      key,
      card,
      rows: list,
      quantity: list.reduce((s, r) => s + r.quantity, 0),
      unitPrice: Math.max(...list.map((r) => rowUnitPrice(r, card.price_usd))),
      value,
      image: rowImage(top, card),
      foil: list.every((r) => r.finish !== "nonfoil"),
      label: list.length === 1 ? setLabel(top) + (top.finish === "nonfoil" ? "" : ` · ${top.finish}`) : `${printings} printing${printings === 1 ? "" : "s"}`,
      added: list.reduce((m, r) => ((r.added_at ?? "") > m ? (r.added_at ?? "") : m), ""),
    };
  };
  if (!perCard) return kept.map((r) => make(cards[r.oracle_id], [r], `${r.oracle_id}|${r.printing_id ?? ""}|${r.finish}`));
  const byCard = new Map<string, OwnedRow[]>();
  for (const r of kept) byCard.set(r.oracle_id, [...(byCard.get(r.oracle_id) ?? []), r]);
  return [...byCard].map(([id, list]) => make(cards[id], list, id));
}

/** Matches a card name, set code or set name. */
export function matchesQuery(item: CollectionItem, q: string) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return item.card.name.toLowerCase().includes(s) || item.rows.some((r) => r.printing_info && (r.printing_info.set === s || r.printing_info.set_name.toLowerCase().includes(s)));
}

const numberOf = (n: string) => Number.parseInt(n, 10) || 0;
const setKey = (it: CollectionItem) => {
  const p = it.rows.find((r) => r.printing_info)?.printing_info;
  return p ? ([0, p.set, numberOf(p.number), p.number] as const) : ([1, "", 0, ""] as const);
};

export function sortItems(items: CollectionItem[], sort: CollectionSort): CollectionItem[] {
  const byName = (a: CollectionItem, b: CollectionItem) => a.card.name.localeCompare(b.card.name);
  const cmp: Record<CollectionSort, (a: CollectionItem, b: CollectionItem) => number> = {
    name: (a, b) => byName(a, b) || a.label.localeCompare(b.label),
    price: (a, b) => b.unitPrice - a.unitPrice || byName(a, b),
    set: (a, b) => {
      const [ua, sa, na, ra] = setKey(a);
      const [ub, sb, nb, rb] = setKey(b);
      return ua - ub || sa.localeCompare(sb) || na - nb || ra.localeCompare(rb) || byName(a, b);
    },
    added: (a, b) => b.added.localeCompare(a.added) || byName(a, b),
  };
  return [...items].sort(cmp[sort]);
}

export type CollectionSection = { key: string; title: string; items: CollectionItem[]; count: number };
const COLORS: [string, string][] = [["W", "White"], ["U", "Blue"], ["B", "Black"], ["R", "Red"], ["G", "Green"]];

/**
 * Sections in a fixed order, each sorted. By set, a whole-card item shows under every set it has; "Printing
 * unknown" comes last.
 */
export function collectionSections(items: CollectionItem[], group: CollectionGroup, sort: CollectionSort): CollectionSection[] {
  const buckets = new Map<string, { title: string; order: number; name: string; items: CollectionItem[] }>();
  const put = (key: string, title: string, order: number, it: CollectionItem, name = "") => {
    const b = buckets.get(key) ?? { title, order, name, items: [] };
    b.items.push(it);
    buckets.set(key, b);
  };
  for (const it of items) {
    if (group === "none") put("all", "All cards", 0, it);
    else if (group === "set") {
      const seen = new Set<string>();
      for (const r of it.rows) {
        const k = r.printing_info?.set ?? "?";
        if (seen.has(k)) continue;
        seen.add(k);
        put(k, r.printing_info ? `${r.printing_info.set_name} (${k.toUpperCase()})` : "Printing unknown", r.printing_info ? 0 : 1, it, r.printing_info?.set_name.toLowerCase());
      }
    } else if (group === "type") {
      const s = typeSection(it.card.type_line);
      put(s, s, TYPE_DISPLAY_ORDER.indexOf(s), it);
    } else {
      const ci = it.card.color_identity;
      if (isLand(it.card.type_line)) put("lands", "Lands", 100, it);
      else if (ci.length === 0) put("colorless", "Colorless", 6, it);
      else if (ci.length > 1) put("multi", "Multicolor", 5, it);
      else {
        const i = COLORS.findIndex(([c]) => c === ci[0]);
        put(ci[0], COLORS[i]?.[1] ?? ci[0], i, it);
      }
    }
  }
  return [...buckets]
    .sort(([, a], [, b]) => a.order - b.order || a.name.localeCompare(b.name))
    .map(([key, b]) => {
      const list = sortItems(b.items, sort);
      return { key, title: b.title, items: list, count: list.reduce((n, it) => n + it.quantity, 0) };
    });
}
