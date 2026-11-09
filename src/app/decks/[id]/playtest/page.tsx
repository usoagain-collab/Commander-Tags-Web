import { notFound, redirect } from "next/navigation";
import type { DeckCard } from "@/lib/playtest/game";
import { readCardLang, type Localized } from "@/lib/deck/card-language";
import { printingIdFromImage, printingImage } from "@/lib/deck/printing";
import { createClient } from "@/lib/supabase/server";
import { mergeTokens } from "@/lib/deck/token-merge";
import { loadDeck, UUID } from "../load-deck";
import { getProfileLook } from "@/lib/supabase/profile";
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
  const [loaded, look] = await Promise.all([loadDeck(id, "playtest"), getProfileLook()]);
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
      return c ? [{ oracleId: c.oracle_id, name: c.name, image: printing ? printingImage(printing.id, "normal", "front", printing.image_v) : c.image_normal, typeLine: c.type_line, quantity: r.quantity, commander: r.board === "commander" }] : [];
    });
  // Card language (v2): pictures already looked up for your language (the deck page looks up the rest).
  const lang = readCardLang(loaded.profile?.tag_view);
  if (lang !== "en") {
    const ids = [...new Set(cards.map((c) => printingIdFromImage(c.image)).filter((x): x is string => !!x))];
    const supabase = await createClient();
    const found = new Map<string, Localized>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await supabase.from("localized_printings").select("printing_id, localized_id, image_v").eq("lang", lang).in("printing_id", ids.slice(i, i + 100));
      for (const r of data ?? []) if (r.localized_id) found.set(r.printing_id, { localized_id: r.localized_id, image_v: r.image_v });
    }
    for (const c of cards) {
      const id = printingIdFromImage(c.image);
      const hit = id ? found.get(id) : undefined;
      if (hit) c.image = printingImage(hit.localized_id, "normal", "front", hit.image_v);
    }
  }

  // A game table: dark in both looks, so the felt and the cards keep their contrast.
  return (
    <div data-theme="dark" className="h-full bg-background text-foreground">
      <PlaytestTable deck={{ id: deck.id, name: deck.name }} cards={cards} tokens={mergeTokens(loaded.tokens)} canFlag={deck.owner_id === user?.id} playerName={look.name} />
    </div>
  );
}
