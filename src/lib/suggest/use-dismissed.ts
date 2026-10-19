"use client";

// Suggestions dismissed for this deck ("Not for this deck"), saved to decks.dismissed_suggestions (migration
// 0014) a moment after each change. "Show dismissed" in the Suggest panel brings cards back.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useDismissed(deckId: string, initial: string[], readOnly: boolean) {
  const supabase = useMemo(() => createClient(), []);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set(initial));
  const [saveError, setSaveError] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (readOnly) return;
    const timer = setTimeout(async () => {
      const { error } = await supabase.from("decks").update({ dismissed_suggestions: [...dismissed] }).eq("id", deckId);
      setSaveError(error ? `Couldn't save dismissed cards: ${error.message}` : null);
    }, 300);
    return () => clearTimeout(timer);
  }, [dismissed, deckId, readOnly, supabase]);

  const dismiss = useCallback((id: string) => setDismissed((d) => new Set(d).add(id)), []);
  const restore = useCallback(
    (id: string) =>
      setDismissed((d) => {
        const next = new Set(d);
        next.delete(id);
        return next;
      }),
    [],
  );
  return { dismissed, dismiss, restore, saveError };
}
