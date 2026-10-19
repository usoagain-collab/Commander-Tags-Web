// How the mainboard is laid out: the View / Group / Sort toolbar (Phase 3a).
import { TYPE_DISPLAY_ORDER, typeSection, type DeckLine } from "./model";

const LANDS_KEY = "lands";
import { isLand } from "@/lib/tags/roles";

export type ViewMode = "text" | "grid" | "stacks";
export type GroupBy = "type" | "role" | "mv" | "color" | "mytags";
export type SortBy = "name" | "mv" | "price";
export type ViewSettings = { view: ViewMode; group: GroupBy; sort: SortBy };

export const VIEW_LABELS: Record<ViewMode, string> = { text: "Text", grid: "Visual grid", stacks: "Stacks" };
export const GROUP_LABELS: Record<GroupBy, string> = { type: "Type", role: "Role", mv: "Mana value", color: "Color", mytags: "My tags" };
export const SORT_LABELS: Record<SortBy, string> = { name: "Name", mv: "Mana value", price: "Price" };
export const DEFAULT_VIEW: ViewSettings = { view: "text", group: "type", sort: "mv" };

/** Reads saved settings defensively (they come from the user's profile JSON). */
export function readViewSettings(saved: unknown): ViewSettings {
  const s = (saved ?? {}) as Partial<Record<keyof ViewSettings, string>>;
  return {
    view: s.view && s.view in VIEW_LABELS ? (s.view as ViewMode) : DEFAULT_VIEW.view,
    group: s.group && s.group in GROUP_LABELS ? (s.group as GroupBy) : DEFAULT_VIEW.group,
    sort: s.sort && s.sort in SORT_LABELS ? (s.sort as SortBy) : DEFAULT_VIEW.sort,
  };
}

export type Section = {
  key: string;
  title: string;
  lines: DeckLine[];
  count: number;
  /** Set on role subgroups: the role this subgroup belongs to (step 3e). */
  parent?: { key: string; title: string; count: number };
};

export function sortLines(lines: DeckLine[], sort: SortBy): DeckLine[] {
  const byName = (a: DeckLine, b: DeckLine) => a.card.name.localeCompare(b.card.name);
  const price = (l: DeckLine) => (l.card.price_usd == null ? -1 : Number(l.card.price_usd));
  return [...lines].sort((a, b) => {
    if (sort === "mv") return a.card.mana_value - b.card.mana_value || byName(a, b);
    if (sort === "price") return price(b) - price(a) || byName(a, b);
    return byName(a, b);
  });
}

export type RoleContext = {
  /** Role keys a card fills, in role order (see rolesOf). */
  rolesOf: (line: DeckLine) => string[];
  roleOrder: { key: string; name: string }[];
  /**
   * Optional role subgroups: which subgroup a card goes in within a role, or null for "Other <role>".
   * A role is only split when it ends up with at least two different subgroups.
   */
  subgroupOf?: (line: DeckLine, roleKey: string) => { key: string; title: string } | null;
  /** Group by My tags (step 3f): the card's tags, in tag order. A card appears under each of its tags. */
  myTagsOf?: (line: DeckLine) => { key: string; title: string; order: number }[];
};

const COLOR_ORDER = ["W", "U", "B", "R", "G"] as const;
const COLOR_NAMES: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };

/** One section per group, in a fixed order, each sorted by the chosen sort. */
export function groupLines(lines: DeckLine[], group: GroupBy, sort: SortBy, roles?: RoleContext): Section[] {
  const buckets = new Map<string, { title: string; order: number; lines: DeckLine[] }>();
  const put = (key: string, title: string, order: number, line: DeckLine) => {
    const b = buckets.get(key) ?? { title, order, lines: [] };
    b.lines.push(line);
    buckets.set(key, b);
  };

  for (const line of lines) {
    const land = isLand(line.card.type_line);
    if (group === "type") {
      const s = typeSection(line.card.type_line);
      put(s, s, TYPE_DISPLAY_ORDER.indexOf(s), line);
    } else if (group === "role") {
      // Grouped by the first non-land role the card fills (a card can fill several; the editor shows
      // "+N roles"), so an MDFC like Sink into Stupor sits with its spell role. Lands go at the bottom.
      const filled = roles?.rolesOf(line) ?? [];
      const first = filled.find((k) => k !== LANDS_KEY) ?? filled[0];
      const idx = roles?.roleOrder.findIndex((r) => r.key === first) ?? -1;
      if (first === LANDS_KEY) put(LANDS_KEY, roles!.roleOrder[idx]?.name ?? "Lands", 2000, line);
      else if (idx >= 0) put(first!, roles!.roleOrder[idx].name, idx, line);
      else put("other", "Other", 1000, line);
    } else if (group === "mytags") {
      const mine = roles?.myTagsOf?.(line) ?? [];
      if (!mine.length) put("untagged", "No tag", 1e6, line);
      for (const t of mine) put(`tag:${t.key}`, t.title, t.order, line);
    } else if (group === "mv") {
      if (land) put("lands", "Lands", 100, line);
      else {
        const mv = Math.min(7, Math.floor(line.card.mana_value));
        put(`mv${mv}`, mv === 7 ? "Mana value 7+" : `Mana value ${mv}`, mv, line);
      }
    } else {
      // By color identity (what Commander's color rules use).
      const ci = line.card.color_identity;
      if (land) put("lands", "Lands", 100, line);
      else if (ci.length === 0) put("colorless", "Colorless", 6, line);
      else if (ci.length > 1) put("multi", "Multicolor", 5, line);
      else put(ci[0], COLOR_NAMES[ci[0]] ?? ci[0], COLOR_ORDER.indexOf(ci[0] as (typeof COLOR_ORDER)[number]), line);
    }
  }

  const total = (ls: DeckLine[]) => ls.reduce((n, l) => n + l.quantity, 0);
  return [...buckets.entries()]
    .sort(([, a], [, b]) => a.order - b.order)
    .flatMap(([key, b]): Section[] => {
      const sorted = sortLines(b.lines, sort);
      const whole: Section = { key, title: b.title, lines: sorted, count: total(sorted) };
      if (group !== "role" || key === "other" || !roles?.subgroupOf) return [whole];

      // Split the role into subgroups (Ramp › Mana rock, Mana dork…), "Other …" last.
      const subs = new Map<string, { title: string; lines: DeckLine[] }>();
      for (const line of sorted) {
        const sg = roles.subgroupOf(line, key) ?? { key: "other", title: `Other ${b.title.toLowerCase()}` };
        const entry = subs.get(sg.key) ?? { title: sg.title, lines: [] };
        entry.lines.push(line);
        subs.set(sg.key, entry);
      }
      if (subs.size < 2) return [whole];
      const parent = { key, title: b.title, count: whole.count };
      return [...subs.entries()]
        .sort(([ka, a], [kb, b2]) => Number(ka === "other") - Number(kb === "other") || total(b2.lines) - total(a.lines) || a.title.localeCompare(b2.title))
        .map(([sk, sub]) => ({ key: `${key}/${sk}`, title: sub.title, lines: sub.lines, count: total(sub.lines), parent }));
    });
}
