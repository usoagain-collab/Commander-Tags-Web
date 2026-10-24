import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { entryKey, type Board, type CardSummary, type Categories, type Entries } from "@/lib/deck/model";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import { readCustomRoles, readTargets } from "@/lib/tags/role-settings";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import { readSuggestSettings } from "@/lib/suggest/score";
import type { BracketNumber } from "@/lib/brackets/rules";
import { DeckEditor, type Visibility } from "./deck-editor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Deck · Commander Tags" };
  const supabase = await createClient();
  const { data } = await supabase.from("decks").select("name").eq("id", id).maybeSingle();
  // A shared (unlisted) deck isn't readable directly; its name comes with shared_deck().
  const name = data?.name ?? ((await supabase.rpc("shared_deck", { p_id: id })).data as { deck?: { name: string } } | null)?.deck?.name;
  return { title: name ? `${name} · Commander Tags` : "Deck · Commander Tags" };
}

type DeckRow = {
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
type CardRow = { oracle_id: string; board: string; quantity: number; category: string | null };

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  // Independent requests run together (each one is a round trip to the database).
  const [userRes, deckRes, rowsRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("decks")
      .select("id, name, owner_id, visibility, role_targets, custom_roles, suggest_settings, dismissed_suggestions, target_bracket, playtest_flags")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("deck_cards").select("oracle_id, board, quantity, category").eq("deck_id", id),
  ]);
  const user = userRes.data.user;
  let deck = deckRes.data as DeckRow | null;
  let rows = (rowsRes.data ?? []) as CardRow[];

  // Not yours and not public: it may be an unlisted deck opened from a share link (Phase 7a).
  if (!deck) {
    const { data: shared } = await supabase.rpc("shared_deck", { p_id: id });
    if (!shared) {
      if (!user) redirect(`/login?next=${encodeURIComponent(`/decks/${id}`)}`);
      notFound();
    }
    deck = (shared as { deck: DeckRow }).deck;
    rows = (shared as { rows: CardRow[] }).rows;
  } else if (rowsRes.error) {
    throw new Error(`Couldn't load the deck's cards: ${rowsRes.error.message}`);
  }

  const [summaries, profileRes] = await Promise.all([
    fetchSummaries(supabase, [...new Set(rows.map((r) => r.oracle_id))]),
    user
      ? supabase.from("profiles").select("tag_view, default_role_targets, custom_roles, hidden_tags").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const profile = profileRes.data as {
    tag_view?: Record<string, unknown>;
    default_role_targets?: unknown;
    custom_roles?: unknown;
    hidden_tags?: string[];
  } | null;

  const entries: Entries = {};
  const categories: Categories = {};
  for (const r of rows) {
    entries[entryKey(r.board as Board, r.oracle_id)] = r.quantity;
    if (r.category) categories[entryKey(r.board as Board, r.oracle_id)] = r.category;
  }
  const cards = Object.fromEntries((summaries as CardSummary[]).map((c) => [c.oracle_id, c]));
  const owner = deck.owner_id === user?.id;

  return (
    <DeckEditor
      deck={{ id: deck.id, name: deck.name, visibility: deck.visibility }}
      initialEntries={entries}
      initialCategories={categories}
      initialCards={cards}
      readOnly={!owner}
      savedTagView={profile?.tag_view ?? {}}
      hiddenTags={profile?.hidden_tags ?? []}
      userId={user?.id ?? null}
      roleTargets={readTargets(deck.role_targets)}
      customRoles={readCustomRoles(deck.custom_roles)}
      suggestSettings={readSuggestSettings(owner ? deck.suggest_settings : null)}
      dismissedSuggestions={owner ? (deck.dismissed_suggestions ?? []) : []}
      playtestFlags={owner ? (deck.playtest_flags ?? {}) : {}}
      targetBracket={((deck.target_bracket as number | null) ?? 3) as BracketNumber}
      profileDefaults={{
        targets: { ...DEFAULT_ROLE_TARGETS, ...readTargets(profile?.default_role_targets) },
        custom: readCustomRoles(profile?.custom_roles),
      }}
    />
  );
}
