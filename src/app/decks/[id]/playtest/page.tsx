import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import type { DeckCard } from "@/lib/playtest/game";
import type { DeckToken } from "@/lib/deck/tokens";
import { PlaytestTable } from "./playtest-table";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("decks").select("name").eq("id", id).maybeSingle();
  return { title: data ? `Playtest: ${data.name} · Commander Tags` : "Playtest · Commander Tags" };
}

/** The playtester (Phase 6): the commander(s) and mainboard; the maybeboard and companion stay out of the game. */
export default async function PlaytestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: deck } = await supabase.from("decks").select("id, name").eq("id", id).maybeSingle();
  if (!deck) notFound();

  const { data: rows, error } = await supabase
    .from("deck_cards")
    .select("oracle_id, board, quantity")
    .eq("deck_id", id)
    .in("board", ["commander", "main"]);
  if (error) throw new Error(`Couldn't load the deck's cards: ${error.message}`);
  const summaries = await fetchSummaries(supabase, (rows ?? []).map((r) => r.oracle_id as string));
  const byId = new Map(summaries.map((c) => [c.oracle_id, c]));

  const cards: DeckCard[] = (rows ?? []).flatMap((r) => {
    const c = byId.get(r.oracle_id as string);
    return c
      ? [{ oracleId: c.oracle_id, name: c.name, image: c.image_normal, typeLine: c.type_line, quantity: r.quantity as number, commander: r.board === "commander" }]
      : [];
  });

  // Tokens the deck can make (6c), for the playtester's Tokens button.
  const { data: tokens } = await supabase.rpc("tokens_for", { p_ids: [...new Set(cards.map((c) => c.oracleId))] });

  return <PlaytestTable deck={{ id: deck.id as string, name: deck.name as string }} cards={cards} tokens={(tokens ?? []) as DeckToken[]} />;
}
