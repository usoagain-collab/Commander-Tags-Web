// Deck editing logic, kept free of React and Supabase so it can be unit-tested.
//
// Every edit is a Change: a list of row changes, each "this card on this board goes from N copies to M".
// Applying a change forward sets the new counts; applying it backward restores the old ones. That makes
// undo/redo exact, and the same row list is what autosave sends to the database.

export type Board = "commander" | "main" | "maybe" | "companion";
export const BOARDS: Board[] = ["commander", "main", "companion", "maybe"];
export const BOARD_LABELS: Record<Board, string> = {
  commander: "Commander",
  main: "Mainboard",
  companion: "Companion",
  maybe: "Maybeboard",
};

export type CardSummary = {
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  mana_value: number;
  type_line: string;
  color_identity: string[];
  image_normal: string | null;
  image_art_crop: string | null;
  price_usd: number | null;
  edhrec_rank: number | null;
  commander_legal: boolean;
  game_changer: boolean;
  max_copies: number;
  can_be_commander: boolean;
  /** Scryfall layout: normal, modal_dfc, transform, split, ... */
  layout: string;
  /** Playable as a land: a land front face, or a modal double-faced card with a land face (counts toward Lands). */
  counts_as_land: boolean;
};

/** Copies of each card on each board, keyed by `board|oracle_id`. */
export type Entries = Record<string, number>;

export type RowChange = { oracle_id: string; board: Board; from: number; to: number };
/** A manual category (step 3f): a role key, "none" for no role, or null for automatic. */
export type CategoryChange = { oracle_id: string; board: Board; from: string | null; to: string | null };
/** A My tag put on (true) or taken off (false) a card (step 3f). */
export type TagCardChange = { tag_id: string; oracle_id: string; from: boolean; to: boolean };
/** One edit, and one undo step. Card counts, plus any category or My tag changes made with it. */
export type Change = { label: string; rows: RowChange[]; categories?: CategoryChange[]; tagCards?: TagCardChange[] };
/** Manual categories, keyed like entries (`board|oracle_id`). Missing = automatic. */
export type Categories = Record<string, string>;
/** My tags on each card: oracle_id -> tag ids. */
export type TagCards = Record<string, string[]>;
export type Plan = { ok: true; change: Change } | { ok: false; reason: string };

export const entryKey = (board: Board, oracleId: string) => `${board}|${oracleId}`;

export function parseKey(key: string): { board: Board; oracle_id: string } {
  const [board, oracle_id] = key.split("|");
  return { board: board as Board, oracle_id };
}

export const qty = (entries: Entries, board: Board, oracleId: string) => entries[entryKey(board, oracleId)] ?? 0;

// ---------- applying and undoing ----------

export function applyChange(entries: Entries, change: Change, direction: "forward" | "back" = "forward"): Entries {
  const next = { ...entries };
  for (const row of change.rows) {
    const n = direction === "forward" ? row.to : row.from;
    const k = entryKey(row.board, row.oracle_id);
    if (n > 0) next[k] = n;
    else delete next[k];
  }
  return next;
}

/** The rows autosave sends: the final count for each touched card/board (0 = remove). */
export function toSaveRows(change: Change, direction: "forward" | "back" = "forward") {
  return change.rows.map((r) => ({
    oracle_id: r.oracle_id,
    board: r.board,
    quantity: direction === "forward" ? r.to : r.from,
  }));
}

export function applyCategories(categories: Categories, change: Change, direction: "forward" | "back" = "forward"): Categories {
  if (!change.categories?.length) return categories;
  const next = { ...categories };
  for (const c of change.categories) {
    const v = direction === "forward" ? c.to : c.from;
    const k = entryKey(c.board, c.oracle_id);
    if (v) next[k] = v;
    else delete next[k];
  }
  return next;
}

export function applyTagCards(tagCards: TagCards, change: Change, direction: "forward" | "back" = "forward"): TagCards {
  if (!change.tagCards?.length) return tagCards;
  const next = { ...tagCards };
  for (const t of change.tagCards) {
    const on = direction === "forward" ? t.to : t.from;
    const ids = (next[t.oracle_id] ?? []).filter((id) => id !== t.tag_id);
    if (on) ids.push(t.tag_id);
    if (ids.length) next[t.oracle_id] = ids;
    else delete next[t.oracle_id];
  }
  return next;
}

/** Everything one save call sends (apply_deck_changes): card counts, categories, My tags. */
export type SavePayload = {
  rows: { oracle_id: string; board: Board; quantity: number }[];
  categories: { oracle_id: string; board: Board; category: string | null }[];
  tag_cards: { tag_id: string; oracle_id: string; on: boolean }[];
};
export function toSavePayload(change: Change, direction: "forward" | "back" = "forward"): SavePayload {
  const fwd = direction === "forward";
  return {
    rows: toSaveRows(change, direction),
    categories: (change.categories ?? []).map((c) => ({ oracle_id: c.oracle_id, board: c.board, category: fwd ? c.to : c.from })),
    tag_cards: (change.tagCards ?? []).map((t) => ({ tag_id: t.tag_id, oracle_id: t.oracle_id, on: fwd ? t.to : t.from })),
  };
}

/**
 * Keeps manual categories through an edit. A removed row takes its category with it, so record that (undo
 * then brings it back), and a card moved to another board keeps its category there.
 */
export function keepCategories(change: Change, categories: Categories): Change {
  const extra: CategoryChange[] = [];
  const touched = new Set((change.categories ?? []).map((c) => entryKey(c.board, c.oracle_id)));
  for (const r of change.rows) {
    const cat = categories[entryKey(r.board, r.oracle_id)];
    if (!cat || r.from === 0 || r.to > 0 || touched.has(entryKey(r.board, r.oracle_id))) continue;
    extra.push({ oracle_id: r.oracle_id, board: r.board, from: cat, to: null });
    const dest = change.rows.find((d) => d.oracle_id === r.oracle_id && d.board !== r.board && d.from === 0 && d.to > 0);
    if (dest && !categories[entryKey(dest.board, dest.oracle_id)] && !touched.has(entryKey(dest.board, dest.oracle_id))) {
      extra.push({ oracle_id: dest.oracle_id, board: dest.board, from: null, to: cat });
    }
  }
  return extra.length ? { ...change, categories: [...(change.categories ?? []), ...extra] } : change;
}

/** Sets or clears a card's manual category. `name` is what the label shows ("Ramp", "automatic"). */
export function planCategory(categories: Categories, card: CardSummary, board: Board, to: string | null, name: string): Plan {
  const from = categories[entryKey(board, card.oracle_id)] ?? null;
  if (from === to) return { ok: false, reason: "No change." };
  return {
    ok: true,
    change: {
      label: to ? `Put ${card.name} in ${name}` : `Set ${card.name} back to automatic`,
      rows: [],
      categories: [{ oracle_id: card.oracle_id, board, from, to }],
    },
  };
}

/** Puts a My tag on cards, or takes it off. Cards already in that state are skipped. */
export function planTagCards(tagCards: TagCards, tagId: string, tagName: string, cards: CardSummary[], on: boolean): Plan {
  const changes = cards
    .filter((c) => (tagCards[c.oracle_id] ?? []).includes(tagId) !== on)
    .map((c) => ({ tag_id: tagId, oracle_id: c.oracle_id, from: !on, to: on }));
  if (!changes.length) return { ok: false, reason: "No change." };
  const what = cards.length === 1 ? cards[0].name : `${changes.length} cards`;
  return {
    ok: true,
    change: { label: on ? `Tag ${what} "${tagName}"` : `Untag "${tagName}" from ${what}`, rows: [], tagCards: changes },
  };
}

/** After a tag is deleted, undo/redo steps must not try to put it back on cards (the save would fail). */
export function dropTagFromChanges(changes: Change[], tagId: string): Change[] {
  return changes
    .map((c) => (c.tagCards?.some((t) => t.tag_id === tagId) ? { ...c, tagCards: c.tagCards.filter((t) => t.tag_id !== tagId) } : c))
    .filter((c) => c.rows.length || c.categories?.length || c.tagCards?.length);
}

// ---------- planning edits (checks the rules, returns a Change or a reason it isn't allowed) ----------

/** Boards that count toward the 100-card deck, where singleton rules apply across boards. */
const DECK_BOARDS: Board[] = ["commander", "main", "companion"];

function copiesInDeck(entries: Entries, oracleId: string) {
  return DECK_BOARDS.reduce((n, b) => n + qty(entries, b, oracleId), 0);
}

export function planAdd(entries: Entries, card: CardSummary, board: Board): Plan {
  const current = qty(entries, board, card.oracle_id);

  if (board === "commander" || board === "companion") {
    if (current > 0) return { ok: false, reason: `${card.name} is already your ${board}.` };
    return { ok: true, change: { label: `Set ${card.name} as ${board}`, rows: [row(card, board, 0, 1)] } };
  }

  if (board === "main" && copiesInDeck(entries, card.oracle_id) >= card.max_copies) {
    return {
      ok: false,
      reason:
        card.max_copies === 1
          ? `${card.name} is already in the deck (Commander decks allow one copy).`
          : `${card.name} is already at its limit of ${card.max_copies} copies.`,
    };
  }
  if (board === "maybe" && current > 0 && current >= card.max_copies) {
    return { ok: false, reason: `${card.name} is already on the maybeboard.` };
  }

  return { ok: true, change: { label: `Add ${card.name}`, rows: [row(card, board, current, current + 1)] } };
}

export function planSetQuantity(entries: Entries, card: CardSummary, board: Board, wanted: number): Plan {
  const current = qty(entries, board, card.oracle_id);
  const cap = board === "commander" || board === "companion" ? 1 : card.max_copies;
  const otherDeckCopies = board === "main" ? copiesInDeck(entries, card.oracle_id) - current : 0;
  const n = Math.max(0, Math.min(Math.floor(wanted), cap - otherDeckCopies));
  if (n === current) return { ok: false, reason: n === cap ? `${card.name} is at its copy limit.` : "No change." };
  const label = n === 0 ? `Remove ${card.name}` : `Set ${card.name} to ${n}`;
  return { ok: true, change: { label, rows: [row(card, board, current, n)] } };
}

export const planRemove = (entries: Entries, card: CardSummary, board: Board) => planSetQuantity(entries, card, board, 0);

/** Moves a card between boards. Commander and companion take exactly one copy; the rest stay behind. */
export function planMove(entries: Entries, card: CardSummary, from: Board, to: Board): Plan {
  if (from === to) return { ok: false, reason: "No change." };
  const have = qty(entries, from, card.oracle_id);
  if (have === 0) return { ok: false, reason: `${card.name} isn't on the ${from} board.` };
  const there = qty(entries, to, card.oracle_id);

  let moving = to === "commander" || to === "companion" ? 1 : have;
  if (to === "commander" || to === "companion") {
    if (there > 0) return { ok: false, reason: `${card.name} is already your ${to}.` };
  } else {
    const cap = card.max_copies;
    // Moving within the deck (e.g. commander -> main) doesn't change the deck count; into it from maybe does.
    const deckAfter = DECK_BOARDS.includes(from) ? copiesInDeck(entries, card.oracle_id) : copiesInDeck(entries, card.oracle_id) + moving;
    if (to === "main" && deckAfter > cap) moving -= deckAfter - cap;
    moving = Math.min(moving, cap - there);
    if (moving <= 0) return { ok: false, reason: `${card.name} is already at its copy limit there.` };
  }

  return {
    ok: true,
    change: {
      label: `Move ${card.name} to ${BOARD_LABELS[to].toLowerCase()}`,
      rows: [row(card, from, have, have - moving), row(card, to, there, there + moving)],
    },
  };
}

/**
 * Bulk edit (step 3g): runs one plan per card against the deck as it changes (so copy limits see the earlier
 * cards' effects), then joins them into one Change: one save, one Ctrl+Z. Cards whose plan is refused are
 * skipped and their reasons returned.
 */
export function planBulk<T>(
  entries: Entries,
  items: T[],
  planOne: (entries: Entries, item: T) => Plan,
  label: (done: number) => string,
): { plan: Plan; done: number; skipped: string[] } {
  let current = entries;
  const rows = new Map<string, RowChange>();
  const skipped: string[] = [];
  let done = 0;
  for (const item of items) {
    const p = planOne(current, item);
    if (!p.ok) {
      if (p.reason !== "No change.") skipped.push(p.reason);
      continue;
    }
    done++;
    current = applyChange(current, p.change);
    for (const r of p.change.rows) {
      const k = entryKey(r.board, r.oracle_id);
      const prev = rows.get(k);
      rows.set(k, prev ? { ...prev, to: r.to } : { ...r });
    }
  }
  const joined = [...rows.values()].filter((r) => r.from !== r.to);
  const plan: Plan = joined.length ? { ok: true, change: { label: label(done), rows: joined } } : { ok: false, reason: skipped[0] ?? "No change." };
  return { plan, done, skipped };
}

const row = (card: CardSummary, board: Board, from: number, to: number): RowChange => ({
  oracle_id: card.oracle_id,
  board,
  from,
  to,
});

// ---------- reading the deck ----------

export type DeckLine = { board: Board; quantity: number; card: CardSummary };

export function linesFor(entries: Entries, cards: Record<string, CardSummary>, board: Board): DeckLine[] {
  return Object.entries(entries)
    .map(([k, quantity]) => ({ ...parseKey(k), quantity }))
    .filter((e) => e.board === board && cards[e.oracle_id])
    .map((e) => ({ board: e.board, quantity: e.quantity, card: cards[e.oracle_id] }));
}

/**
 * Which type section a card files under: the FIRST of these its front face has, so an Artifact Creature is a
 * Creature and an Artifact Land is a Land. (This is precedence, not display order; see TYPE_DISPLAY_ORDER.)
 */
export const TYPE_SECTIONS = ["Land", "Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment"] as const;
export type TypeSection = (typeof TYPE_SECTIONS)[number] | "Other";

/** The order sections appear on screen and in exports: lands at the bottom (David, Oct 18, 2026). */
export const TYPE_DISPLAY_ORDER: TypeSection[] = [
  "Creature",
  "Artifact",
  "Enchantment",
  "Sorcery",
  "Instant",
  "Planeswalker",
  "Battle",
  "Other",
  "Land",
];

export function typeSection(typeLine: string): TypeSection {
  const front = typeLine.split(" // ")[0]; // modal double-faced cards file under their front face
  return TYPE_SECTIONS.find((t) => front.includes(t)) ?? "Other";
}

export function groupByType(lines: DeckLine[]): { section: TypeSection; lines: DeckLine[]; count: number }[] {
  const groups = new Map<TypeSection, DeckLine[]>();
  for (const line of lines) {
    const s = typeSection(line.card.type_line);
    groups.set(s, [...(groups.get(s) ?? []), line]);
  }
  return TYPE_DISPLAY_ORDER.filter((s) => groups.has(s))
    .map((section) => {
      const sorted = groups
        .get(section)!
        .sort((a, b) => a.card.mana_value - b.card.mana_value || a.card.name.localeCompare(b.card.name));
      return { section, lines: sorted, count: sorted.reduce((n, l) => n + l.quantity, 0) };
    });
}

/** Cards that count toward the 100: commander(s), companion excluded, plus mainboard. */
export function deckSize(entries: Entries) {
  return Object.entries(entries).reduce((n, [k, q]) => {
    const { board } = parseKey(k);
    return board === "commander" || board === "main" ? n + q : n;
  }, 0);
}

/** The deck's color identity: the union of its commanders' identities (null when there is no commander yet). */
export function deckIdentity(entries: Entries, cards: Record<string, CardSummary>): Set<string> | null {
  const commanders = linesFor(entries, cards, "commander");
  if (commanders.length === 0) return null;
  return new Set(commanders.flatMap((l) => l.card.color_identity));
}

export function outsideIdentity(card: CardSummary, identity: Set<string> | null) {
  return identity !== null && card.color_identity.some((c) => !identity.has(c));
}

export function totalPrice(entries: Entries, cards: Record<string, CardSummary>, boards: Board[] = ["commander", "main", "companion"]) {
  return Object.entries(entries).reduce((sum, [k, q]) => {
    const { board, oracle_id } = parseKey(k);
    const p = cards[oracle_id]?.price_usd;
    return boards.includes(board) && p ? sum + Number(p) * q : sum;
  }, 0);
}
