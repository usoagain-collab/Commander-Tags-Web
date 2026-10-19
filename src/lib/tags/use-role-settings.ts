"use client";

// A deck's role targets and custom roles: edited with the sliders, saved to the deck half a second after
// the last change. Not part of Ctrl+Z, which stays for card edits (Phase 3 plan).
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CustomRole } from "./role-settings";

export function useRoleSettings(deckId: string, initialTargets: Record<string, number>, initialCustom: CustomRole[], readOnly: boolean) {
  const supabase = useMemo(() => createClient(), []);
  const [targets, setTargets] = useState(initialTargets);
  const [custom, setCustom] = useState(initialCustom);
  const [saveError, setSaveError] = useState<string | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (readOnly) return;
    const timer = setTimeout(async () => {
      const { error } = await supabase.from("decks").update({ role_targets: targets, custom_roles: custom }).eq("id", deckId);
      setSaveError(error ? `Couldn't save role targets: ${error.message}` : null);
    }, 500);
    return () => clearTimeout(timer);
  }, [targets, custom, deckId, readOnly, supabase]);

  return { targets, setTargets, custom, setCustom, saveError };
}
