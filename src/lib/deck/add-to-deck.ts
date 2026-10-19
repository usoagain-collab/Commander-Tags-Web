"use client";

// Adds one card to a deck that isn't open in the editor (drops on "My decks", "Add to another deck…").
// Reads that deck's current copies of the card first, so the singleton and copy-limit rules still apply.
import type { SupabaseClient } from "@supabase/supabase-js";
import { entryKey, planAdd, toSaveRows, type Board, type CardSummary, type Entries } from "./model";

export async function addCardToDeck(
  supabase: SupabaseClient,
  deckId: string,
  card: CardSummary,
  board: Board = "main",
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: rows, error: readError } = await supabase
    .from("deck_cards")
    .select("board, quantity")
    .eq("deck_id", deckId)
    .eq("oracle_id", card.oracle_id);
  if (readError) return { ok: false, reason: `Couldn't read the deck: ${readError.message}` };

  const entries: Entries = {};
  for (const r of rows ?? []) entries[entryKey(r.board as Board, card.oracle_id)] = r.quantity as number;

  const plan = planAdd(entries, card, board);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  const { error } = await supabase.rpc("apply_deck_changes", { p_deck: deckId, p_changes: toSaveRows(plan.change) });
  if (error) return { ok: false, reason: `Couldn't save: ${error.message}` };
  return { ok: true };
}
