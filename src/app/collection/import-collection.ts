// Collection import (v2): names resolve through our database (cards rows must exist), printings through Scryfall
// by id (ManaBox, Archidekt) or set and collector number (Moxfield, plain lists). A printing that names a
// different card than the line's name is ignored, so the copies count as printing unknown.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeImported, type ImportedCard, type OwnedRow } from "@/lib/deck/collection";
import { finishFor, infoOf } from "@/lib/deck/collection-targets";
import type { CardSummary } from "@/lib/deck/model";
import { fetchPrintingsById, fetchPrintingsByRef, printingRef } from "@/lib/scryfall/printings";

export async function resolveImport(supabase: SupabaseClient, parsed: ImportedCard[], progress: (message: string) => void) {
  progress("Looking up the cards…");
  const names = [...new Set(parsed.map((c) => c.name))];
  const found = new Map<string, string>();
  for (let i = 0; i < names.length; i += 500) {
    const { data, error } = await supabase.rpc("resolve_card_names", { names: names.slice(i, i + 500) });
    if (error) throw new Error(`Couldn't look up the cards: ${error.message}`);
    for (const { input, card } of (data ?? []) as { input: string; card: CardSummary }[]) found.set(input.toLowerCase(), card.oracle_id);
  }

  const ids = parsed.flatMap((c) => (c.scryfallId ? [c.scryfallId] : []));
  const refs = parsed.flatMap((c) => (!c.scryfallId && c.set && c.number ? [{ set: c.set, number: c.number }] : []));
  if (ids.length || refs.length) progress(`Looking up ${ids.length + refs.length} printings on Scryfall…`);
  // A failed printing lookup still imports the cards, as printing unknown.
  const [byId, byRef] = await Promise.all([
    ids.length ? fetchPrintingsById(ids).catch(() => new Map()) : new Map(),
    refs.length ? fetchPrintingsByRef(refs).catch(() => new Map()) : new Map(),
  ]);

  let unknown = 0;
  let printed = 0;
  const rows: OwnedRow[] = [];
  for (const c of parsed) {
    const oracleId = found.get(c.name.toLowerCase());
    if (!oracleId) {
      unknown++;
      continue;
    }
    const hit = c.scryfallId ? byId.get(c.scryfallId) : c.set && c.number ? byRef.get(printingRef(c.set, c.number)) : undefined;
    const p = hit && hit.oracleId === oracleId ? hit.printing : null;
    if (p) printed += c.quantity;
    rows.push({
      oracle_id: oracleId,
      printing_id: p?.id ?? null,
      // The export's finish, unless the printing can't be that (an etched-only printing is never plain foil).
      finish: p ? (c.finish === "etched" && p.finishes.includes("etched") ? "etched" : finishFor(p, c.finish !== "nonfoil")) : c.finish,
      quantity: Math.min(9999, c.quantity),
      printing_info: p ? infoOf(p) : null,
    });
  }
  return { rows: mergeImported(rows), unknown, printed, copies: rows.reduce((n, r) => n + r.quantity, 0) };
}
