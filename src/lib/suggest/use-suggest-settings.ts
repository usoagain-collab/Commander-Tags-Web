"use client";

// A deck's suggestion style, price cap and custom weights (decks.suggest_settings, migration 0013), saved half
// a second after the last change, like the role sliders. Not part of Ctrl+Z.
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SuggestSettings } from "./score";

export function useSuggestSettings(deckId: string, initial: SuggestSettings, readOnly: boolean) {
  const supabase = useMemo(() => createClient(), []);
  const [settings, setSettings] = useState(initial);
  const [saveError, setSaveError] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (readOnly) return;
    const timer = setTimeout(async () => {
      const { error } = await supabase.from("decks").update({ suggest_settings: settings }).eq("id", deckId);
      setSaveError(error ? `Couldn't save the suggestion style: ${error.message}` : null);
    }, 500);
    return () => clearTimeout(timer);
  }, [settings, deckId, readOnly, supabase]);

  return { settings, setSettings, saveError };
}
