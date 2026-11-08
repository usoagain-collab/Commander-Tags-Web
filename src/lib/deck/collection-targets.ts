// From a deck row to collection rows (v2): which printings a row shows, and the changes that make you own them.
// The printing on screen counts even with no pick (David, Nov 8, 2026), so a default row is its default image's printing.
import { fetchPrintingsById } from "@/lib/scryfall/printings";
import { exactCopies, rowKey, type Collection, type Finish, type PrintingInfo, type WantedPart } from "./collection";
import { entryKey, type CardSummary, type DeckLine } from "./model";
import { foilFor, printingIdFromImage, type ChosenPrinting } from "./printing";
import { splitParts, type Splits } from "./splits";
import type { OwnedTarget } from "./use-collection";

export type ShownPart = WantedPart & { printing?: ChosenPrinting };

export const infoOf = (p: ChosenPrinting): PrintingInfo => ({
  set: p.set,
  set_name: p.set_name,
  number: p.number,
  illustration_id: p.illustration_id,
  finishes: p.finishes,
  usd: p.usd,
  usd_foil: p.usd_foil,
  usd_etched: p.usd_etched,
});

/**
 * The finish of a copy, foil or not, as this printing can actually be: a foil-only printing is always foil, one with
 * no foil never is, and a foil copy is etched only when the printing has no plain foil. Unknown printing: as asked.
 */
export function finishFor(p: Pick<ChosenPrinting, "finishes"> | null | undefined, foil: boolean): Finish {
  if (!p) return foil ? "foil" : "nonfoil";
  if (!foilFor(p.finishes, foil)) return "nonfoil";
  return p.finishes.includes("foil") ? "foil" : "etched";
}

/** The copies a deck row shows, printing by printing. `base` is the card as the site shows it by default. */
export function shownParts(line: DeckLine, splits: Splits, base: CardSummary | undefined): ShownPart[] {
  const defaultId = printingIdFromImage((base ?? line.card).image_normal);
  return splitParts(line.quantity, line.printing, splits[entryKey(line.board, line.card.oracle_id)]).map((p) => ({
    printingId: p.printing?.id ?? defaultId,
    foil: !!p.printing?.foil,
    quantity: p.quantity,
    ...(p.printing ? { printing: p.printing } : {}),
  }));
}

/** Looks up the printings these parts need but don't carry (default printings) on Scryfall, in one go. */
async function infosFor(parts: ShownPart[]) {
  const missing = parts.filter((p) => !p.printing && p.printingId).map((p) => p.printingId!);
  const found = missing.length ? await fetchPrintingsById(missing) : new Map();
  return (p: ShownPart): { info: PrintingInfo | null; finishes: string[] | null } => {
    const full = p.printing ?? (p.printingId ? found.get(p.printingId)?.printing : undefined);
    return full ? { info: infoOf(full), finishes: full.finishes } : { info: null, finishes: null };
  };
}

/**
 * The collection changes that make you own every copy these rows show in that exact printing (bulk "Mark owned"):
 * each printing is topped up by what's missing, never lowered. Rows you already own exactly need nothing.
 */
export async function markOwnedChanges(c: Collection, rows: { oracleId: string; parts: ShownPart[] }[]) {
  const short = rows.flatMap((r) => {
    const byKey = new Map<string, ShownPart>();
    for (const p of r.parts) {
      if (!p.printingId) continue;
      const k = `${p.printingId}|${p.foil}`;
      const had = byKey.get(k);
      byKey.set(k, had ? { ...had, quantity: had.quantity + p.quantity } : p);
    }
    return [...byKey.values()].flatMap((p) => {
      const missing = p.quantity - exactCopies(c, r.oracleId, p.printingId, p.foil);
      return missing > 0 ? [{ oracleId: r.oracleId, part: p, missing }] : [];
    });
  });
  if (!short.length) return [];
  const lookup = await infosFor(short.map((s) => s.part));
  const out = new Map<string, { target: OwnedTarget; quantity: number }>();
  for (const s of short) {
    const { info, finishes } = lookup(s.part);
    const target: OwnedTarget = { oracle_id: s.oracleId, printing_id: s.part.printingId, finish: finishFor(finishes ? { finishes } : null, s.part.foil), printing_info: info };
    const k = rowKey(target);
    const had = out.get(k)?.quantity ?? (c.get(s.oracleId) ?? []).find((r) => rowKey(r) === k)?.quantity ?? 0;
    out.set(k, { target, quantity: had + s.missing });
  }
  return [...out.values()];
}

/** The collection row for one shown printing (card sheet's buttons), with its details looked up when needed. */
export async function targetFor(oracleId: string, part: ShownPart): Promise<OwnedTarget | null> {
  if (!part.printingId) return null;
  const { info, finishes } = (await infosFor([part]))(part);
  return { oracle_id: oracleId, printing_id: part.printingId, finish: finishFor(finishes ? { finishes } : null, part.foil), printing_info: info };
}
