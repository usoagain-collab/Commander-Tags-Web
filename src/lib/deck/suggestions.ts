// Suggest changes (V3, migration 0061): someone who can open a shared deck suggests cards to add and cut; the
// owner applies them, sends the adds to the maybeboard, or dismisses them. Until the migration runs, loading fails
// quietly and nothing about suggestions shows.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { planAdd, planBulk, planRemove, type CardSummary, type Entries, type Plan } from "@/lib/deck/model";

export const SUGGEST_CARDS_MAX = 30;
export const SUGGEST_NOTE_MAX = 500;

export type SuggestionStatus = "open" | "applied" | "maybe" | "dismissed";
export type ChangeSuggestion = {
  id: string;
  adds: string[];
  cuts: string[];
  note: string | null;
  status: SuggestionStatus;
  created_at: string;
  author: string | null;
  avatar_url: string | null;
  mine: boolean;
};

const STATUSES: SuggestionStatus[] = ["open", "applied", "maybe", "dismissed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the server's list defensively; malformed rows are dropped. */
export function readSuggestions(raw: unknown): ChangeSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && UUID.test(x)) : []);
  return raw.flatMap((r): ChangeSuggestion[] => {
    if (!r || typeof r !== "object") return [];
    const x = r as Record<string, unknown>;
    if (typeof x.id !== "string") return [];
    const status = STATUSES.includes(x.status as SuggestionStatus) ? (x.status as SuggestionStatus) : "open";
    return [
      {
        id: x.id,
        adds: ids(x.adds),
        cuts: ids(x.cuts),
        note: typeof x.note === "string" && x.note.trim() ? x.note : null,
        status,
        created_at: typeof x.created_at === "string" ? x.created_at : new Date(0).toISOString(),
        author: typeof x.author === "string" && x.author.trim() ? x.author : null,
        avatar_url: typeof x.avatar_url === "string" ? x.avatar_url : null,
        mine: x.mine === true,
      },
    ];
  });
}

/** A suggestion ready to send: each card once, no card both added and cut, capped; null when it has no cards. */
export function cleanSuggestion(adds: string[], cuts: string[], note: string) {
  const a = [...new Set(adds)].slice(0, SUGGEST_CARDS_MAX);
  const c = [...new Set(cuts)].filter((id) => !a.includes(id)).slice(0, SUGGEST_CARDS_MAX);
  if (!a.length && !c.length) return null;
  const n = note.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, SUGGEST_NOTE_MAX).trim();
  return { adds: a, cuts: c, note: n || null };
}

/**
 * The deck edit for a suggestion, as one change (one save, one undo). "apply" adds to the mainboard and cuts from
 * it; "maybe" only puts the adds on the maybeboard. Cards already in the deck or no longer in it are skipped.
 */
export function planSuggestion(
  entries: Entries,
  adds: CardSummary[],
  cuts: CardSummary[],
  how: "apply" | "maybe",
): { plan: Plan; done: number; skipped: string[] } {
  type Item = { card: CardSummary; cut: boolean };
  const items: Item[] = [...adds.map((card) => ({ card, cut: false })), ...(how === "apply" ? cuts.map((card) => ({ card, cut: true })) : [])];
  return planBulk(
    entries,
    items,
    (e, it) => (it.cut ? planRemove(e, it.card, "main") : planAdd(e, it.card, how === "apply" ? "main" : "maybe")),
    (n) => (how === "apply" ? `Apply a suggestion (${n} ${n === 1 ? "card" : "cards"})` : `Add ${n} suggested ${n === 1 ? "card" : "cards"} to the maybeboard`),
  );
}

/** "2 adds, 1 cut". */
export function suggestionSummary(s: Pick<ChangeSuggestion, "adds" | "cuts">) {
  const parts = [];
  if (s.adds.length) parts.push(`${s.adds.length} ${s.adds.length === 1 ? "add" : "adds"}`);
  if (s.cuts.length) parts.push(`${s.cuts.length} ${s.cuts.length === 1 ? "cut" : "cuts"}`);
  return parts.join(", ");
}

/** Postgres raises our own plain sentences; show those, and a general line for anything technical. */
export function suggestionError(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  return /^(Sign in|That deck|This is your own|Pick at least|Suggest up to|The note|That is a lot)/.test(message) ? message : fallback;
}

export type Suggestions = {
  /** null while loading; false before migration 0061 runs or when not signed in. */
  available: boolean | null;
  list: ChangeSuggestion[];
  open: ChangeSuggestion[];
  send: (adds: string[], cuts: string[], note: string) => Promise<string | null>;
  decide: (id: string, status: Exclude<SuggestionStatus, "open">) => Promise<string | null>;
  withdraw: (id: string) => Promise<string | null>;
};

export function useSuggestions(deckId: string, enabled: boolean): Suggestions {
  const supabase = useMemo(() => createClient(), []);
  const [available, setAvailable] = useState<boolean | null>(enabled ? null : false);
  const [list, setList] = useState<ChangeSuggestion[]>([]);

  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc("deck_suggestions_for", { p_deck: deckId });
    if (error) return setAvailable(false);
    setList(readSuggestions(data));
    setAvailable(true);
  }, [supabase, deckId]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const send = useCallback(
    async (adds: string[], cuts: string[], note: string) => {
      const s = cleanSuggestion(adds, cuts, note);
      if (!s) return "Pick at least one card to add or cut.";
      const { error } = await supabase.rpc("suggest_deck_changes", { p_deck: deckId, p_adds: s.adds, p_cuts: s.cuts, p_note: s.note });
      if (error) return suggestionError(error.message, "Couldn't send your suggestion.");
      await reload();
      return null;
    },
    [supabase, deckId, reload],
  );

  const decide = useCallback(
    async (id: string, status: Exclude<SuggestionStatus, "open">) => {
      const { data, error } = await supabase.rpc("decide_deck_suggestion", { p_id: id, p_status: status });
      if (error || data !== true) return "Couldn't update that suggestion.";
      setList((l) => l.map((s) => (s.id === id ? { ...s, status } : s)));
      return null;
    },
    [supabase],
  );

  const withdraw = useCallback(
    async (id: string) => {
      const { data, error } = await supabase.rpc("withdraw_deck_suggestion", { p_id: id });
      if (error || data !== true) return "Couldn't withdraw that suggestion.";
      setList((l) => l.filter((s) => s.id !== id));
      return null;
    },
    [supabase],
  );

  const open = useMemo(() => list.filter((s) => s.status === "open"), [list]);
  return { available, list, open, send, decide, withdraw };
}
