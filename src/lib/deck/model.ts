// Deck editing logic, kept free of React and Supabase so it can be unit-tested.
//
// Every edit is a Change: a list of row changes, each "this card on this board goes from N copies to M".
// Applying a change forward sets the new counts; applying it backward restores the old ones. That makes
// undo/redo exact, and the same row list is what autosave sends to the database.

import { foilFor, printingImage, printingPrice, type ChosenPrinting } from "./printing";
import type { PriceTrend, StorePrices } from "./store-prices";

export type Board = "commander" | "main" | "maybe" | "companion";
export const BOARDS: Board[] = ["commander", "main", "companion", "maybe"];
export const BOARD_LABELS: Record<Board, string> = {
  commander: "Commander",
  main: "Mainboard",
  companion: "Companion",
  maybe: "Maybeboard",
};

export type CommanderStatus = "legal" | "banned" | "preview" | "not_legal";

/** A short label for cards that searches only show with "Include banned and preview cards" on; null otherwise. */
export function statusLabel(card: Pick<CardSummary, "commander_status">): string | null {
  return card.commander_status === "banned" ? "Banned" : card.commander_status === "preview" ? "Preview" : null;
}

export type CardSummary = {
  oracle_id: string;
  name: string;
  mana_cost: string | null;
  mana_value: number;
  type_line: string;
  color_identity: string[];
  image_normal: string | null;
  image_art_crop: string | null;
  /** Illustrator of image_art_crop, for the art credit Scryfall asks for. Missing before migration 0051. */
  artist?: string | null;
  price_usd: number | null;
  edhrec_rank: number | null;
  commander_legal: boolean;
  /** legal, banned, preview (not released yet) or not_legal (tokens, Un-cards...). Missing on rows saved before 0031. */
  commander_status?: CommanderStatus;
  game_changer: boolean;
  max_copies: number;
  can_be_commander: boolean;
  /** Scryfall layout: normal, modal_dfc, transform, split, ... */
  layout: string;
  /** Playable as a land: a land front face, or a modal double-faced card with a land face (counts toward Lands). */
  counts_as_land: boolean;
  /** Colors of mana it can make (W U B R G C), for land-source stats (step 3i). */
  produced_mana?: string[];
  /** An instant, or has Flash (Smart Cutter speed; migration 0031). */
  instant_speed?: boolean;
  /** The cheapest printing at Card Kingdom, Mana Pool and Cardmarket (migration 0053; missing before it). */
  store_prices?: StorePrices | null;
  /** 7- and 30-day change of the cheapest TCGplayer price (migration 0053). */
  price_trend?: PriceTrend | null;
  /** Set by priceCard when another source replaced price_usd: the TCGplayer price, for the store list. */
  tcg_usd?: number | null;
};

/** Copies of each card on each board, keyed by `board|oracle_id`. */
export type Entries = Record<string, number>;

export type RowChange = { oracle_id: string; board: Board; from: number; to: number };
/** A manual category (step 3f): a role key, "none" for no role, or null for automatic. */
export type CategoryChange = { oracle_id: string; board: Board; from: string | null; to: string | null };
/** A My tag put on (true) or taken off (false) a card (step 3f). */
export type TagCardChange = { tag_id: string; oracle_id: string; from: boolean; to: boolean };
/** A row's chosen printing and foil state changing; null = the default printing. */
export type PrintingChange = { oracle_id: string; board: Board; from: ChosenPrinting | null; to: ChosenPrinting | null };
/** One edit, and one undo step. Card counts, plus any category, My tag or printing changes made with it. */
export type Change = {
  label: string;
  rows: RowChange[];
  categories?: CategoryChange[];
  tagCards?: TagCardChange[];
  printings?: PrintingChange[];
  /** Restoring a version (step 3h): save the current deck as a version with this name before applying. */
  snapshot?: string;
  /** Smart Cutter (C2): a label for the edit and a reason per card, kept in the change log. */
  notes?: ChangeNotes;
};
/** Shown in History's Timeline: the edit's label and why each card changed (oracle_id -> reason). */
export type ChangeNotes = { label: string; cards: Record<string, string> };
/** Manual categories, keyed like entries (`board|oracle_id`). Missing = automatic. */
export type Categories = Record<string, string>;
/** My tags on each card: oracle_id -> tag ids. */
export type TagCards = Record<string, string[]>;
/** Chosen printings, keyed like entries (`board|oracle_id`). Missing = default printing. */
export type Printings = Record<string, ChosenPrinting>;
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

export function applyPrintings(printings: Printings, change: Change, direction: "forward" | "back" = "forward"): Printings {
  if (!change.printings?.length) return printings;
  const next = { ...printings };
  for (const p of change.printings) {
    const v = direction === "forward" ? p.to : p.from;
    const k = entryKey(p.board, p.oracle_id);
    if (v) next[k] = v;
    else delete next[k];
  }
  return next;
}

/** Everything one save call sends (apply_deck_changes): card counts, categories, My tags, printings. */
export type SavePayload = {
  rows: { oracle_id: string; board: Board; quantity: number }[];
  categories: { oracle_id: string; board: Board; category: string | null }[];
  tag_cards: { tag_id: string; oracle_id: string; on: boolean }[];
  printings: { oracle_id: string; board: Board; printing: ChosenPrinting | null }[];
  snapshot_name?: string;
  notes?: ChangeNotes;
};
export function toSavePayload(change: Change, direction: "forward" | "back" = "forward"): SavePayload {
  const fwd = direction === "forward";
  return {
    rows: toSaveRows(change, direction),
    categories: (change.categories ?? []).map((c) => ({ oracle_id: c.oracle_id, board: c.board, category: fwd ? c.to : c.from })),
    tag_cards: (change.tagCards ?? []).map((t) => ({ tag_id: t.tag_id, oracle_id: t.oracle_id, on: fwd ? t.to : t.from })),
    printings: (change.printings ?? []).map((p) => ({ oracle_id: p.oracle_id, board: p.board, printing: fwd ? p.to : p.from })),
    ...(fwd && change.snapshot ? { snapshot_name: change.snapshot } : {}),
    // Undo shows as the opposite change with no label, like any other undo.
    ...(fwd && change.notes ? { notes: change.notes } : {}),
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

/** Same for printings: a removed row takes its printing with it (undo brings it back), a moved card keeps it. */
export function keepPrintings(change: Change, printings: Printings): Change {
  const extra: PrintingChange[] = [];
  const touched = new Set((change.printings ?? []).map((p) => entryKey(p.board, p.oracle_id)));
  for (const r of change.rows) {
    const chosen = printings[entryKey(r.board, r.oracle_id)];
    if (!chosen || r.from === 0 || r.to > 0 || touched.has(entryKey(r.board, r.oracle_id))) continue;
    extra.push({ oracle_id: r.oracle_id, board: r.board, from: chosen, to: null });
    const dest = change.rows.find((d) => d.oracle_id === r.oracle_id && d.board !== r.board && d.from === 0 && d.to > 0);
    if (dest && !printings[entryKey(dest.board, dest.oracle_id)] && !touched.has(entryKey(dest.board, dest.oracle_id))) {
      extra.push({ oracle_id: dest.oracle_id, board: dest.board, from: null, to: chosen });
    }
  }
  return extra.length ? { ...change, printings: [...(change.printings ?? []), ...extra] } : change;
}

/** Sets a row's printing and foil state, or (null) goes back to the default printing. */
export function planPrinting(printings: Printings, card: CardSummary, board: Board, to: ChosenPrinting | null): Plan {
  const from = printings[entryKey(board, card.oracle_id)] ?? null;
  if (from?.id === to?.id && !!from?.foil === !!to?.foil) return { ok: false, reason: "No change." };
  const label = !to
    ? `Set ${card.name} back to its default printing`
    : from?.id === to.id
      ? `Mark ${card.name} ${to.foil ? "foil" : "not foil"}`
      : `Use the ${to.set_name} printing of ${card.name}${to.foil ? " (foil)" : ""}`;
  return { ok: true, change: { label, rows: [], printings: [{ oracle_id: card.oracle_id, board, from, to }] } };
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
    .filter((c) => c.rows.length || c.categories?.length || c.tagCards?.length || c.printings?.length);
}

// ---------- planning edits (checks the rules, returns a Change or a reason it isn't allowed) ----------

/** Boards that count toward the 100-card deck, where singleton rules apply across boards. */
const DECK_BOARDS: Board[] = ["commander", "main", "companion"];

function copiesInDeck(entries: Entries, oracleId: string) {
  return DECK_BOARDS.reduce((n, b) => n + qty(entries, b, oracleId), 0);
}

/** A deck has at most two commanders (partners), and only cards that can lead a deck qualify. */
function commanderRefusal(entries: Entries, card: CardSummary) {
  if (!card.can_be_commander) return `${card.name} can't be a commander.`;
  const commanders = Object.keys(entries).filter((k) => k.startsWith("commander|") && entries[k] > 0).length;
  return commanders >= 2 ? "A deck can have at most two commanders. Move one out first." : null;
}

export function planAdd(entries: Entries, card: CardSummary, board: Board): Plan {
  const current = qty(entries, board, card.oracle_id);

  if (board === "commander" || board === "companion") {
    if (current > 0) return { ok: false, reason: `${card.name} is already your ${board}.` };
    const refused = board === "commander" && commanderRefusal(entries, card);
    if (refused) return { ok: false, reason: refused };
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
    const refused = to === "commander" && commanderRefusal(entries, card);
    if (refused) return { ok: false, reason: refused };
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

/** Your default printing of each card (oracle_id -> printing), for rows with no printing of their own. */
export type PreferredPrintings = Record<string, ChosenPrinting>;

/**
 * What each row shows: the printing picked in this deck, else your default. Use the result to display, price and
 * export; edits, undo and versions work on the deck's own picks. A default that only comes in foil shows as foil.
 */
export function effectivePrintings(entries: Entries, printings: Printings, preferred: PreferredPrintings): Printings {
  const out: Printings = { ...printings };
  for (const k of Object.keys(entries)) {
    const fallback = preferred[parseKey(k).oracle_id];
    if (!out[k] && fallback) out[k] = { ...fallback, foil: foilFor(fallback.finishes, false) };
  }
  return out;
}

/** `card` already shows the row's chosen printing: its image, art and price. */
export type DeckLine = { board: Board; quantity: number; card: CardSummary; printing?: ChosenPrinting };

/**
 * A card as its chosen printing shows it. A printing with no price for this finish falls back to the card's
 * cheapest price (the card sheet marks that as an estimate).
 */
export function withPrinting(card: CardSummary, printing: ChosenPrinting | undefined): CardSummary {
  if (!printing) return card;
  return {
    ...card,
    image_normal: printingImage(printing.id, "normal", "front", printing.image_v),
    image_art_crop: printingImage(printing.id, "art_crop", "front", printing.image_v),
    // A printing saved before its artist was known shows no credit rather than the default printing's artist.
    artist: printing.artist ?? null,
    price_usd: printingPrice(printing) ?? card.price_usd,
  };
}

export function linesFor(entries: Entries, cards: Record<string, CardSummary>, board: Board, printings: Printings = {}): DeckLine[] {
  return Object.entries(entries)
    .map(([k, quantity]) => ({ ...parseKey(k), quantity }))
    .filter((e) => e.board === board && cards[e.oracle_id])
    .map((e) => {
      const printing = printings[entryKey(e.board, e.oracle_id)];
      return { board: e.board, quantity: e.quantity, card: withPrinting(cards[e.oracle_id], printing), ...(printing ? { printing } : {}) };
    });
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

export function totalPrice(
  entries: Entries,
  cards: Record<string, CardSummary>,
  boards: Board[] = ["commander", "main", "companion"],
  printings: Printings = {},
) {
  return Object.entries(entries).reduce((sum, [k, q]) => {
    const { board, oracle_id } = parseKey(k);
    const card = cards[oracle_id];
    const p = card && withPrinting(card, printings[k]).price_usd;
    return boards.includes(board) && p ? sum + Number(p) * q : sum;
  }, 0);
}
