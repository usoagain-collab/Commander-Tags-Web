"use client";

// Turns a dropped card (see scryfall-drop.ts) into one of our CardSummary rows.
// Exact ids go through Scryfall's API (one request) to get the oracle_id; a bare name uses our own lookup.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardSummary } from "@/lib/deck/model";
import type { DropRef } from "./scryfall-drop";

type Result = { ok: true; card: CardSummary } | { ok: false; reason: string };

async function oracleIdFromScryfall(ref: DropRef): Promise<string | null> {
  const path = ref.scryfallId
    ? `cards/${ref.scryfallId}`
    : ref.set && ref.number
      ? `cards/${encodeURIComponent(ref.set)}/${encodeURIComponent(ref.number)}`
      : null;
  if (!path) return null;
  try {
    const res = await fetch(`https://api.scryfall.com/${path}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const card = (await res.json()) as { oracle_id?: string; card_faces?: { oracle_id?: string }[] };
    return card.oracle_id ?? card.card_faces?.[0]?.oracle_id ?? null;
  } catch {
    return null;
  }
}

export async function resolveDrop(ref: DropRef, supabase: SupabaseClient): Promise<Result> {
  const oracleId = await oracleIdFromScryfall(ref);
  if (oracleId) {
    const { data } = await supabase.from("card_summaries").select("*").eq("oracle_id", oracleId).maybeSingle();
    if (data) return { ok: true, card: data as CardSummary };
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
