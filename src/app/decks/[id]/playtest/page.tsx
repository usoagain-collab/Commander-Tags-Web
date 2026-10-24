import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import type { DeckCard } from "@/lib/playtest/game";
import { mergeTokens, type DeckToken } from "@/lib/deck/token-merge";
import { PlaytestTable } from "./playtest-table";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("decks").select("name").eq("id", id).maybeSingle();
  const name = data?.name ?? ((await supabase.rpc("shared_deck", { p_id: id })).data as { deck?: { name: string } } | null)?.deck?.name;
  return { title: name ? `Playtest: ${name} · Commander Tags` : "Playtest · Commander Tags" };
}

/** The playtester (Phase 6): the commander(s) and mainboard; the maybeboard and companion stay out of the game. */
export default async function PlaytestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let { data: deck } = await supabase.from("decks").select("id, name, owner_id").eq("id", id).maybeSingle();
  let rows: { oracle_id: string; board: string; quantity: number }[] | null = null;
  if (deck) {
    const res = await supabase.from("deck_cards").select("oracle_id, board, quantity").eq("deck_id", id).in("board", ["commander", "main"]);
    if (res.error) throw new Error(`Couldn't load the deck's cards: ${res.error.message}`);
    rows = res.data;
  } else {
    // An unlisted deck opened from a share link (Phase 7a).
    const { data: shared } = await supabase.rpc("shared_deck", { p_id: id });
    if (!shared) {
      if (!user) redirect(`/login?next=${encodeURIComponent(`/decks/${id}/playtest`)}`);
      notFound();
    }
    const s = shared as { deck: { id: string; name: string; owner_id: string }; rows: { oracle_id: string; board: string; quantity: number }[] };
    deck = s.deck;
    rows = s.rows.filter((r) => r.board === "commander" || r.board === "main");
  }
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

  return <PlaytestTable deck={{ id: deck.id as string, name: deck.name as string }} cards={cards} tokens={mergeTokens((tokens ?? []) as DeckToken[])} canFlag={deck.owner_id === user?.id} />;
}
