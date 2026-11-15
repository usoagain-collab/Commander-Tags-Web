"use client";

// Loads the combos for "Combos one card away" (V3). The combos table is readable by anyone (migration 0015), so the
// browser asks it for combos touching the deck's cards, then loads the missing cards' details to check colors.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import type { CardSummary } from "@/lib/deck/model";
import type { ComboRow } from "./evaluate";
import { combosOneAway, type OneAway } from "./one-away";

const COLUMNS = "id, card_a, card_b, results, bracket_tag, requires, popularity";

export function useCombosOneAway(ids: string[], identity: Set<string> | null, enabled: boolean) {
  const supabase = useMemo(() => createClient(), []);
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  const colors = identity ? [...identity].sort().join("") : null;
  const [state, setState] = useState<{ groups: OneAway[]; cards: Map<string, CardSummary>; error: string | null; loading: boolean }>({
    groups: [],
    cards: new Map(),
    error: null,
    loading: false,
  });

  useEffect(() => {
    if (!enabled || !key) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const deck = key.split(",");
        // Ids go in the address, so ask in batches of 100 (fetch-summaries.ts), once per side of the pair.
        const batches: string[][] = [];
        for (let i = 0; i < deck.length; i += 100) batches.push(deck.slice(i, i + 100));
        const asks = batches.flatMap((b) =>
          (["card_a", "card_b"] as const).map((side) =>
            supabase.from("combos").select(COLUMNS).eq("requires", 0).in(side, b).order("popularity", { ascending: false, nullsFirst: false }).limit(400),
          ),
        );
        const results = await Promise.all(asks);
        const failed = results.find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
        const rows = results.flatMap((r) => (r.data ?? []) as ComboRow[]);
        const inDeck = new Set(deck);
        const missing = [...new Set(rows.flatMap((c) => (inDeck.has(c.card_a) === inDeck.has(c.card_b) ? [] : [inDeck.has(c.card_a) ? c.card_b : c.card_a])))];
        const cards = new Map((await fetchSummaries(supabase, missing)).map((c) => [c.oracle_id, c]));
        const allowed = (id: string) => {
          const c = cards.get(id);
          if (!c || !c.commander_legal) return false;
          return colors === null || c.color_identity.every((x) => colors.includes(x));
        };
        if (live) setState({ groups: combosOneAway(rows, inDeck, allowed), cards, error: null, loading: false });
      } catch (e) {
        if (live) setState((s) => ({ ...s, loading: false, error: `Couldn't look for near combos: ${e instanceof Error ? e.message : String(e)}` }));
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, colors, enabled, supabase]);

  return state;
}
