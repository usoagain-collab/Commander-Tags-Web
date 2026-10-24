// Tokens a deck can make (Phase 6c), from tokens_for() (migration 0018). Scryfall gives each token as a printing
// id; its image lives on Scryfall's image CDN at a path built from that id, so no API call is needed.
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type DeckToken = { token_id: string; name: string; type_line: string; made_by: string[] };

/** Scryfall CDN image for a printing id: /normal/front/<1st char>/<2nd char>/<id>.jpg */
export const tokenImage = (printingId: string) =>
  `https://cards.scryfall.io/normal/front/${printingId[0]}/${printingId[1]}/${printingId}.jpg`;

/** The tokens the given cards make, re-asked a moment after the card list changes. */
export function useDeckTokens(ids: string[]) {
  const supabase = useMemo(() => createClient(), []);
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  const [tokens, setTokens] = useState<DeckToken[] | null>(null);
  useEffect(() => {
    if (!key) {
      setTokens([]);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("tokens_for", { p_ids: key.split(",") });
      if (live) setTokens(error ? [] : ((data ?? []) as DeckToken[]));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, supabase]);
  return tokens;
}
