"use client";

// Your default printing of each card. Saved straight away rather than through Ctrl+Z: it reaches every deck of
// yours, so it doesn't belong in one deck's undo history.
import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PreferredPrintings } from "./model";
import type { ChosenPrinting } from "./printing";

export function usePreferredPrintings(initial: PreferredPrintings) {
  const supabase = useMemo(() => createClient(), []);
  const [preferred, setPreferred] = useState(initial);

  /** Sets a card's default, or (null) clears it. Returns a problem to show, or null. */
  const setDefault = useCallback(
    async (oracleId: string, printing: ChosenPrinting | null) => {
      const before = preferred;
      const next = { ...preferred };
      if (printing) next[oracleId] = { ...printing, foil: false };
      else delete next[oracleId];
      setPreferred(next);
      let failed;
      if (printing) {
        const info: Partial<ChosenPrinting> = { ...printing };
        delete info.id;
        delete info.foil;
        ({ error: failed } = await supabase
          .from("preferred_printings")
          .upsert({ oracle_id: oracleId, printing_id: printing.id, printing_info: info, updated_at: new Date().toISOString() }));
      } else {
        ({ error: failed } = await supabase.from("preferred_printings").delete().eq("oracle_id", oracleId));
      }
      if (failed) {
        setPreferred(before);
        return `Couldn't save your default: ${failed.message}`;
      }
      return null;
    },
    [preferred, supabase],
  );

  return { preferred, setDefault };
}
