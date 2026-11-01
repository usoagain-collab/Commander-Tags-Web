"use client";

// Turns a dropped card (see scryfall-drop.ts) into one of our CardSummary rows.
// Exact ids go through Scryfall's API (one request) to get the oracle_id; a bare name uses our own lookup.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardSummary } from "@/lib/deck/model";
import type { DropRef } from "./scryfall-drop";
import type { ChosenPrinting } from "@/lib/deck/printing";
import { oracleIdOf, toPrinting, type ScryfallPrint } from "@/lib/scryfall/printings";
import { importCard } from "@/lib/scryfall/import-card";

/** `printing`: the exact printing that was dragged, when the drop says which. */
type Result = { ok: true; card: CardSummary; printing?: ChosenPrinting } | { ok: false; reason: string };

async function printFromScryfall(ref: DropRef): Promise<ScryfallPrint | null> {
  const path = ref.scryfallId
    ? `cards/${ref.scryfallId}`
    : ref.set && ref.number
      ? `cards/${encodeURIComponent(ref.set)}/${encodeURIComponent(ref.number)}`
      : null;
  if (!path) return null;
  try {
    const res = await fetch(`https://api.scryfall.com/${path}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as ScryfallPrint;
  } catch {
    return null;
  }
}

export async function resolveDrop(ref: DropRef, supabase: SupabaseClient): Promise<Result> {
  const print = await printFromScryfall(ref);
  const oracleId = print && oracleIdOf(print);
  if (oracleId) {
    const { data } = await supabase.from("card_summaries").select("*").eq("oracle_id", oracleId).maybeSingle();
    if (data) return { ok: true, card: data as CardSummary, printing: toPrinting(print!, false) };
    // Not in our nightly data yet (a new spoiler): fetch it live when we know its printing (Phase 7b).
    if (ref.scryfallId) {
      const fetched = await importCard(ref.scryfallId);
      if (fetched.ok) return fetched;
    }
    if (!ref.name) return { ok: false, reason: "That card isn't in our card data yet (it refreshes daily)." };
  }
  if (ref.name) {
    const { data } = await supabase.rpc("resolve_card_names", { names: [ref.name] });
    const hit = ((data ?? []) as { card: CardSummary }[])[0];
    if (hit) return { ok: true, card: hit.card };
    return { ok: false, reason: `Couldn't find a card called “${ref.name}”.` };
  }
  return { ok: false, reason: "Couldn't tell which card that was. Try dragging the card image from Scryfall." };
}
