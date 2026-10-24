import { notFound, redirect } from "next/navigation";
import { entryKey, type Board, type CardSummary, type Categories, type Entries } from "@/lib/deck/model";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import { readCustomRoles, readTargets } from "@/lib/tags/role-settings";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import { readSuggestSettings } from "@/lib/suggest/score";
import type { BracketNumber } from "@/lib/brackets/rules";
import { DeckEditor } from "./deck-editor";
import { loadDeck, UUID } from "./load-deck";
import type { InitialTags } from "@/lib/tags/use-tag-data";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Deck · Commander Tags" };
  const { deck } = await loadDeck(id);
  return { title: deck ? `${deck.name} · Commander Tags` : "Deck · Commander Tags" };
}

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, user, deck, rows } = await loadDeck(id);
  if (!deck) {
    if (!user) redirect(`/login?next=${encodeURIComponent(`/decks/${id}`)}`);
    notFound();
  }

  // Card details, the deck's tags and your view settings all load together, so the editor opens with its role
  // profile and top tags ready instead of fetching tags after the page arrives.
  const ids = [...new Set(rows.map((r) => r.oracle_id))];
  const [summaries, initialTags, profileRes] = await Promise.all([
    fetchSummaries(supabase, ids),
    loadTags(supabase, ids),
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
      initialTags={initialTags}
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

/** The deck's card tags (card_tags_for reads up to 400 ids a call, so 300 at a time). Undefined on any error. */
async function loadTags(supabase: SupabaseClient, ids: string[]): Promise<InitialTags | undefined> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 300) chunks.push(ids.slice(i, i + 300));
  const results = await Promise.all(chunks.map((c) => supabase.rpc("card_tags_for", { oracle_ids: c })));
  if (results.some((r) => r.error)) return undefined;
  const out: InitialTags = { o: {}, a: {}, ids };
  for (const r of results) {
    const d = r.data as Omit<InitialTags, "ids">;
    Object.assign(out.o, d.o);
    Object.assign(out.a, d.a);
  }
  return out;
}
