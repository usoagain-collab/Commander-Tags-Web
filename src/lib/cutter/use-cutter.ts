"use client";

// Smart Cutter settings, saved half a second after the last change, like the role sliders (not part of Ctrl+Z):
// the deck's state in decks.cutter (locks, dismissed, archetype answers…) and the user's prefs in
// profiles.cutter_prefs (power user mode, weights…). Migration 0033.
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CutterPrefs, CutterState } from "./state";

function useSaved<T>(initial: T, save: ((value: T) => Promise<string | null>) | null) {
  const [value, setValue] = useState(initial);
  const [saveError, setSaveError] = useState<string | null>(null);
  const first = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!saveRef.current) return;
    const timer = setTimeout(async () => setSaveError(await saveRef.current!(value)), 500);
    return () => clearTimeout(timer);
  }, [value]);
  return { value, setValue, saveError };
}

export function useCutterState(deckId: string, initial: CutterState, readOnly: boolean) {
  const supabase = useMemo(() => createClient(), []);
  const s = useSaved(
    initial,
    readOnly
      ? null
      : async (cutter) => {
          const { error } = await supabase.from("decks").update({ cutter }).eq("id", deckId);
          return error ? `Couldn't save Smart Cutter settings: ${error.message}` : null;
        },
  );
  return { state: s.value, setState: s.setValue, saveError: s.saveError };
}

export function useCutterPrefs(userId: string | null, initial: CutterPrefs) {
  const supabase = useMemo(() => createClient(), []);
  const s = useSaved(
    initial,
    userId
      ? async (cutter_prefs) => {
          const { error } = await supabase.from("profiles").update({ cutter_prefs }).eq("id", userId);
          return error ? `Couldn't save your Smart Cutter settings: ${error.message}` : null;
        }
      : null,
  );
  return { prefs: s.value, setPrefs: s.setValue, saveError: s.saveError };
}
