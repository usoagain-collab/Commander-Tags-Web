// Loads one deck and its card rows for the editor and the playtester. React cache() lets a page and its
// generateMetadata share the same request. Your own and public decks read directly; an unlisted deck opened
// from a share link comes through shared_deck() (Phase 7a). Independent requests run together.
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import type { Visibility } from "./deck-editor";

export type DeckRow = {
  id: string;
  name: string;
  owner_id: string;
  visibility: Visibility;
  role_targets: unknown;
  custom_roles: unknown;
  suggest_settings?: unknown;
  dismissed_suggestions?: string[] | null;
  target_bracket: number | null;
  playtest_flags?: Record<string, number> | null;
};
export type CardRow = { oracle_id: string; board: string; quantity: number; category: string | null };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const loadDeck = cache(async (id: string) => {
  const supabase = await createClient();
  const [user, deckRes, rowsRes] = await Promise.all([
    getCurrentUser(),
    supabase
      .from("decks")
      .select("id, name, owner_id, visibility, role_targets, custom_roles, suggest_settings, dismissed_suggestions, target_bracket, playtest_flags")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("deck_cards").select("oracle_id, board, quantity, category").eq("deck_id", id),
  ]);
  let deck = deckRes.data as DeckRow | null;
  let rows = (rowsRes.data ?? []) as CardRow[];
  if (!deck) {
    const { data: shared } = await supabase.rpc("shared_deck", { p_id: id });
    if (!shared) return { supabase, user, deck: null, rows: [] as CardRow[] };
    deck = (shared as { deck: DeckRow }).deck;
    rows = (shared as { rows: CardRow[] }).rows;
  } else if (rowsRes.error) {
    throw new Error(`Couldn't load the deck's cards: ${rowsRes.error.message}`);
  }
  return { supabase, user, deck, rows };
});
