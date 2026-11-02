import { notFound, redirect } from "next/navigation";
import type { DeckCard } from "@/lib/playtest/game";
import { printingImage } from "@/lib/deck/printing";
import { mergeTokens } from "@/lib/deck/token-merge";
import { loadDeck, UUID } from "../load-deck";
import { PlaytestTable } from "./playtest-table";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Playtest · Deck Genome" };
  const { deck } = await loadDeck(id, "playtest");
  return { title: deck ? `Playtest: ${deck.name} · Deck Genome` : "Playtest · Deck Genome" };
}

/** The playtester (Phase 6): the commander(s) and mainboard; the maybeboard and companion stay out of the game. */
export default async function PlaytestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  // One call brings the deck, its card details and the tokens it can make (6c).
  const loaded = await loadDeck(id, "playtest");
  const { user, deck } = loaded;
  if (!deck) {
    if (!user) redirect(`/login?next=${encodeURIComponent(`/decks/${id}/playtest`)}`);
    notFound();
  }
  const byId = new Map(loaded.cards.map((c) => [c.oracle_id, c]));
  const cards: DeckCard[] = loaded.rows
    .filter((r) => r.board === "commander" || r.board === "main")
    .flatMap((r) => {
      const c = byId.get(r.oracle_id);
      const printing = r.printing ?? loaded.preferred[r.oracle_id];
      return c ? [{ oracleId: c.oracle_id, name: c.name, image: printing ? printingImage(printing.id) : c.image_normal, typeLine: c.type_line, quantity: r.quantity, commander: r.board === "commander" }] : [];
    });

  // A game table: dark in both looks, so the felt and the cards keep their contrast.
  return (
    <div data-theme="dark" className="h-full bg-background text-foreground">
      <PlaytestTable deck={{ id: deck.id, name: deck.name }} cards={cards} tokens={mergeTokens(loaded.tokens)} canFlag={deck.owner_id === user?.id} />
    </div>
  );
}
