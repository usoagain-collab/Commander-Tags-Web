// Mixed copies of one card (v2): some copies of a row can be other printings or foil, such as 10 Forests with
// different art. Stored on the row as deck_cards.printing_split (migration 0039): a list of {printing, quantity}.
// Copies not in the split use the row's own printing (or the default). Editing, undo and autosave are unchanged,
// since a row is still one card on one board; only display, price and export read the split.
import { parseKey, totalPrice, withPrinting, type Board, type CardSummary, type DeckLine, type Entries, type Printings } from "./model";
import type { ChosenPrinting } from "./printing";

export type SplitPart = { printing: ChosenPrinting; quantity: number };
/** Splits by entry key (`board|oracle_id`). */
export type Splits = Record<string, SplitPart[]>;

export function readSplit(raw: unknown): SplitPart[] | null {
  if (!Array.isArray(raw)) return null;
  const parts = raw.flatMap((p) => {
    const q = Math.round(Number(p?.quantity));
    return p?.printing?.id && q > 0 ? [{ printing: p.printing as ChosenPrinting, quantity: Math.min(99, q) }] : [];
  });
  return parts.length ? parts : null;
}

/**
 * The copies of a row, printing by printing: split parts first (trimmed so they never exceed the row's copies),
 * then the rest in the row's own printing (`undefined` = the card's default).
 */
export function splitParts(quantity: number, base: ChosenPrinting | undefined, split: SplitPart[] | undefined): { printing?: ChosenPrinting; quantity: number }[] {
  const out: { printing?: ChosenPrinting; quantity: number }[] = [];
  let left = quantity;
  for (const p of split ?? []) {
    if (left <= 0) break;
    const q = Math.min(p.quantity, left);
    out.push({ printing: p.printing, quantity: q });
    left -= q;
  }
  if (left > 0) out.push({ printing: base, quantity: left });
  return out;
}

/** What a row's copies cost, each at its own printing's price. */
export function rowPrice(card: CardSummary, quantity: number, base: ChosenPrinting | undefined, split: SplitPart[] | undefined): number {
  return splitParts(quantity, base, split).reduce((s, p) => s + Number(withPrinting(card, p.printing).price_usd ?? 0) * p.quantity, 0);
}

/** A deck's lines with each mixed row broken into one line per printing (for exports that name printings). */
export function expandLines(lines: DeckLine[], splits: Splits, base: Record<string, CardSummary>): DeckLine[] {
  return lines.flatMap((l) => {
    const split = splits[`${l.board}|${l.card.oracle_id}`];
    if (!split?.length) return [l];
    const card = base[l.card.oracle_id] ?? l.card;
    return splitParts(l.quantity, l.printing, split).map((p) => ({
      board: l.board,
      quantity: p.quantity,
      card: withPrinting(card, p.printing),
      ...(p.printing ? { printing: p.printing } : {}),
    }));
  });
}

/** How many different looks a row's copies have (shown as "N arts" on the card). */
export function artCount(quantity: number, base: ChosenPrinting | undefined, split: SplitPart[] | undefined): number {
  return new Set(splitParts(quantity, base, split).map((p) => `${p.printing?.id ?? "default"}|${p.printing?.foil ? 1 : 0}`)).size;
}

/** totalPrice, with mixed rows priced copy by copy. */
export function totalPriceWithSplits(
  entries: Entries,
  cards: Record<string, CardSummary>,
  printings: Printings,
  splits: Splits,
  boards: Board[] = ["commander", "main", "companion"],
): number {
  const plain: Entries = {};
  let mixed = 0;
  for (const [k, q] of Object.entries(entries)) {
    const split = splits[k];
    const { board, oracle_id } = parseKey(k);
    if (split?.length && cards[oracle_id]) {
      if (boards.includes(board)) mixed += rowPrice(cards[oracle_id], q, printings[k], split);
    } else plain[k] = q;
  }
  return totalPrice(plain, cards, boards, printings) + mixed;
}
