import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { entryKey, type Board, type CardSummary, type Categories, type Entries } from "@/lib/deck/model";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import { readCustomRoles, readTargets } from "@/lib/tags/role-settings";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import { readSuggestSettings } from "@/lib/suggest/score";
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

  const { data: deck } = await supabase
    .from("decks")
    .select("id, name, owner_id, role_targets, custom_roles, suggest_settings, dismissed_suggestions")
    .eq("id", id)
    .maybeSingle();
  if (!deck) notFound();

  // Two queries: the deck's rows, then the card details for just those cards.
  const { data: rows, error: rowsError } = await supabase.from("deck_cards").select("oracle_id, board, quantity, category").eq("deck_id", id);
  if (rowsError) throw new Error(`Couldn't load the deck's cards: ${rowsError.message}`);
  const oracleIds = [...new Set((rows ?? []).map((r) => r.oracle_id as string))];
  const summaries = await fetchSummaries(supabase, oracleIds);

  const entries: Entries = {};
  const categories: Categories = {};
  for (const r of rows ?? []) {
    entries[entryKey(r.board as Board, r.oracle_id as string)] = r.quantity as number;
    if (r.category) categories[entryKey(r.board as Board, r.oracle_id as string)] = r.category as string;
  }
  const cards = Object.fromEntries(((summaries ?? []) as CardSummary[]).map((c) => [c.oracle_id, c]));

  // The user's remembered View / Group / Sort (and, later, tag panel settings), and their default role targets.
  const { data: profile } = user
    ? await supabase.from("profiles").select("tag_view, default_role_targets, custom_roles, hidden_tags").eq("id", user.id).maybeSingle()
    : { data: null };
  const tagView = (profile?.tag_view ?? {}) as Record<string, unknown>;

  return (
    <DeckEditor
      deck={{ id: deck.id as string, name: deck.name as string }}
      initialEntries={entries}
      initialCategories={categories}
      initialCards={cards}
      readOnly={deck.owner_id !== user?.id}
      savedTagView={tagView}
      hiddenTags={(profile?.hidden_tags as string[] | undefined) ?? []}
      userId={user?.id ?? null}
      roleTargets={readTargets(deck.role_targets)}
      customRoles={readCustomRoles(deck.custom_roles)}
      suggestSettings={readSuggestSettings(deck.suggest_settings)}
      dismissedSuggestions={(deck.dismissed_suggestions as string[] | null) ?? []}
      profileDefaults={{
        targets: { ...DEFAULT_ROLE_TARGETS, ...readTargets(profile?.default_role_targets) },
        custom: readCustomRoles(profile?.custom_roles),
      }}
    />
  );
}
