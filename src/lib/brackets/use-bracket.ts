"use client";

// Phase 5b: the deck's target bracket (decks.target_bracket, saved half a second after a change, not part of
// Ctrl+Z) and the two-card combos inside the deck (combos_within, re-asked when the deck's cards change).
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ComboRow } from "./evaluate";
import type { BracketNumber } from "./rules";

export function useBracketTarget(deckId: string, initial: BracketNumber, readOnly: boolean) {
  const supabase = useMemo(() => createClient(), []);
  const [target, setTarget] = useState<BracketNumber>(initial);
  const [saveError, setSaveError] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (readOnly) return;
    const timer = setTimeout(async () => {
      const { error } = await supabase.from("decks").update({ target_bracket: target }).eq("id", deckId);
      setSaveError(error ? `Couldn't save the target bracket: ${error.message}` : null);
    }, 500);
    return () => clearTimeout(timer);
  }, [target, deckId, readOnly, supabase]);

  return { target, setTarget, saveError };
}

/** Combos whose two cards are both in `ids`. Waits a moment after changes so a burst of edits asks once. */
export function useCombosWithin(ids: string[]) {
  const supabase = useMemo(() => createClient(), []);
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  const [combos, setCombos] = useState<ComboRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setCombos([]);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("combos_within", { p_ids: key.split(",") });
      if (!live) return;
      setError(error ? `Couldn't check for combos: ${error.message}` : null);
      if (!error) setCombos((data ?? []) as ComboRow[]);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, supabase]);

  return { combos, error };
}
