// Oracle text for the deck's lands, for the tapped-land check (V3 mana base checkup). The cards table is public
// to read (migration 0001), so the browser asks it directly, once per change of the land list.
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** oracle_id -> oracle text, or null until it has loaded (or if it failed). */
export function useLandText(ids: string[]) {
  const supabase = useMemo(() => createClient(), []);
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  const [text, setText] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    if (!key) {
      setText(new Map());
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.from("cards").select("oracle_id, oracle_text").in("oracle_id", key.split(","));
      if (!live) return;
      setText(error ? null : new Map((data ?? []).map((r: { oracle_id: string; oracle_text: string | null }) => [r.oracle_id, r.oracle_text ?? ""])));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, supabase]);
  return text;
}
