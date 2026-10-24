import { notFound, redirect } from "next/navigation";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import type { DeckCard } from "@/lib/playtest/game";
import { mergeTokens, type DeckToken } from "@/lib/deck/token-merge";
import { loadDeck, UUID } from "../load-deck";
import { PlaytestTable } from "./playtest-table";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Playtest · Commander Tags" };
  const { deck } = await loadDeck(id);
  return { title: deck ? `Playtest: ${deck.name} · Commander Tags` : "Playtest · Commander Tags" };
}

/** The playtester (Phase 6): the commander(s) and mainboard; the maybeboard and companion stay out of the game. */
export default async function PlaytestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, user, deck, rows: all } = await loadDeck(id);
  if (!deck) {
    if (!user) redirect(`/login?next=${encodeURIComponent(`/decks/${id}/playtest`)}`);
    notFound();
  }
  const rows = all.filter((r) => r.board === "commander" || r.board === "main");
  const ids = [...new Set(rows.map((r) => r.oracle_id))];

  // Card details and the tokens the deck can make (6c) only need the ids, so they load together.
  const [summaries, tokensRes] = await Promise.all([fetchSummaries(supabase, ids), supabase.rpc("tokens_for", { p_ids: ids })]);
  const byId = new Map(summaries.map((c) => [c.oracle_id, c]));

  const cards: DeckCard[] = rows.flatMap((r) => {
    const c = byId.get(r.oracle_id);
    return c ? [{ oracleId: c.oracle_id, name: c.name, image: c.image_normal, typeLine: c.type_line, quantity: r.quantity, commander: r.board === "commander" }] : [];
  });

  return <PlaytestTable deck={{ id: deck.id, name: deck.name }} cards={cards} tokens={mergeTokens((tokensRes.data ?? []) as DeckToken[])} canFlag={deck.owner_id === user?.id} />;
}
