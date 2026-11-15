// Card notes (V3): one private line of text per card in your deck. Saved in deck_card_notes (migration 0055),
// which only the owner can read. Until that migration runs, loading fails quietly and the editor shows no note box.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const NOTE_MAX = 280;

/** Trimmed, line breaks and runs of spaces made single spaces, at most NOTE_MAX characters. "" means no note. */
export function cleanNote(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX).trim();
}

/** The note shortened for a tooltip or a badge. */
export function shortNote(note: string, max = 60): string {
  return note.length <= max ? note : `${note.slice(0, max - 1).trimEnd()}…`;
}

export type CardNotes = {
  /** False until the notes load, and for good when the table isn't there yet or you don't own the deck. */
  available: boolean;
  notes: Record<string, string>;
  /** Saves (or with "", removes) a card's note. Resolves to an error message, or null. */
  save: (oracleId: string, text: string) => Promise<string | null>;
};

export function useCardNotes(deckId: string, owner: boolean): CardNotes {
  const supabase = useMemo(() => createClient(), []);
  const [available, setAvailable] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!owner) return;
    let live = true;
    supabase
      .from("deck_card_notes")
      .select("oracle_id, note")
      .eq("deck_id", deckId)
      .then(({ data, error }) => {
        if (!live || error) return;
        setNotes(Object.fromEntries((data ?? []).map((r) => [r.oracle_id as string, r.note as string])));
        setAvailable(true);
      });
    return () => {
      live = false;
    };
  }, [supabase, deckId, owner]);

  const save = useCallback(
    async (oracleId: string, text: string) => {
      const note = cleanNote(text);
      const { error } = note
        ? await supabase.from("deck_card_notes").upsert({ deck_id: deckId, oracle_id: oracleId, note, updated_at: new Date().toISOString() })
        : await supabase.from("deck_card_notes").delete().eq("deck_id", deckId).eq("oracle_id", oracleId);
      if (error) return `Couldn't save the note: ${error.message}`;
      setNotes((n) => {
        const next = { ...n };
        if (note) next[oracleId] = note;
        else delete next[oracleId];
        return next;
      });
      return null;
    },
    [supabase, deckId],
  );

  return { available, notes, save };
}
