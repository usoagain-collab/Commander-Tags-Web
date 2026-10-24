// Loads one deck for the editor or the playtester in a single database call (deck_bundle, migration 0023): the
// deck, its card rows, card details, and the deck's tags (editor) or tokens (playtester), plus your view
// settings. React cache() lets a page and its generateMetadata share the request. Row-level security decides
// what you can read; an unlisted deck opened from a share link comes through shared_deck (Phase 7a).
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import type { CardSummary } from "@/lib/deck/model";
import type { DeckToken } from "@/lib/deck/token-merge";
import type { InitialTags } from "@/lib/tags/use-tag-data";
import type { ComboRow } from "@/lib/brackets/evaluate";
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
export type Profile = {
  tag_view?: Record<string, unknown> | null;
  default_role_targets?: unknown;
  custom_roles?: unknown;
  hidden_tags?: string[] | null;
};
type Bundle = {
  deck: DeckRow;
  rows: CardRow[];
  cards: CardSummary[];
  tags: Omit<InitialTags, "ids"> | null;
  combos: ComboRow[] | null;
  tokens: DeckToken[] | null;
  profile: Profile | null;
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const loadDeck = cache(async (id: string, kind: "editor" | "playtest") => {
  const supabase = await createClient();
  const [user, res] = await Promise.all([
    getCurrentUser(),
    supabase.rpc("deck_bundle", { p_id: id, p_tags: kind === "editor", p_tokens: kind === "playtest" }),
  ]);
  if (res.error) throw new Error(`Couldn't load the deck: ${res.error.message}`);
  const b = res.data as Bundle | null;
  if (!b) return { user, deck: null } as const;
  const tags: InitialTags | undefined = b.tags ? { ...b.tags, ids: b.cards.map((c) => c.oracle_id) } : undefined;
  return { user, deck: b.deck, rows: b.rows, cards: b.cards, tags, combos: b.combos ?? undefined, tokens: b.tokens ?? [], profile: b.profile } as const;
});
