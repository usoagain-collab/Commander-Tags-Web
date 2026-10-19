import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { entryKey, type Board, type CardSummary, type Entries } from "@/lib/deck/model";
import { readViewSettings } from "@/lib/deck/grouping";
import { DeckEditor } from "./deck-editor";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("decks").select("name").eq("id", id).maybeSingle();
  return { title: data ? `${data.name} · Commander Tags` : "Deck · Commander Tags" };
}

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: deck } = await supabase.from("decks").select("id, name, owner_id").eq("id", id).maybeSingle();
  if (!deck) notFound();

  // Two queries: the deck's rows, then the card details for just those cards.
  const { data: rows } = await supabase.from("deck_cards").select("oracle_id, board, quantity").eq("deck_id", id);
  const oracleIds = [...new Set((rows ?? []).map((r) => r.oracle_id as string))];
  const { data: summaries } = oracleIds.length
    ? await supabase.from("card_summaries").select("*").in("oracle_id", oracleIds)
    : { data: [] as CardSummary[] };

  const entries: Entries = {};
  for (const r of rows ?? []) entries[entryKey(r.board as Board, r.oracle_id as string)] = r.quantity as number;
  const cards = Object.fromEntries(((summaries ?? []) as CardSummary[]).map((c) => [c.oracle_id, c]));

  // The user's remembered View / Group / Sort (and, later, tag panel settings).
  const { data: profile } = user
    ? await supabase.from("profiles").select("tag_view").eq("id", user.id).maybeSingle()
    : { data: null };
  const tagView = (profile?.tag_view ?? {}) as Record<string, unknown>;

  return (
    <DeckEditor
      deck={{ id: deck.id as string, name: deck.name as string }}
      initialEntries={entries}
      initialCards={cards}
      readOnly={deck.owner_id !== user?.id}
      initialView={readViewSettings(tagView)}
      savedTagView={tagView}
      userId={user?.id ?? null}
    />
  );
}
