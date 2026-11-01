"use client";

// Art tags key on the illustration, so they follow a card's chosen printing. The deck's tags arrive with the default
// illustrations; this swaps in the art tags of chosen ones as soon as they load.
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseKey, type Printings } from "@/lib/deck/model";
import type { ArtTag, TagData } from "./use-tag-data";

/** Each card's chosen illustration. A card on two boards uses its deck printing over its maybeboard one. */
export function chosenIllustrations(printings: Printings): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = Object.entries(printings).sort(([a], [b]) => Number(a.startsWith("maybe|")) - Number(b.startsWith("maybe|")));
  for (const [k, p] of entries) {
    const { oracle_id } = parseKey(k);
    if (p.illustration_id && !out[oracle_id]) out[oracle_id] = p.illustration_id;
  }
  return out;
}

export function useChosenArtTags(tags: TagData, printings: Printings): TagData {
  const supabase = useMemo(() => createClient(), []);
  const [byArt, setByArt] = useState<Record<string, ArtTag[]>>({});
  const asked = useRef(new Set<string>());
  const chosen = useMemo(() => chosenIllustrations(printings), [printings]);

  useEffect(() => {
    const missing = [...new Set(Object.values(chosen))].filter((id) => !asked.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => asked.current.add(id));
    (async () => {
      const { data, error } = await supabase.rpc("art_tags_for_illustrations", { p_ids: missing });
      if (error) {
        missing.forEach((id) => asked.current.delete(id));
        return;
      }
      const found = data as Record<string, ArtTag[]>;
      // An illustration with no art tags is an answer too: the card then shows none.
      setByArt((prev) => ({ ...prev, ...Object.fromEntries(missing.map((id) => [id, found[id] ?? []])) }));
    })();
  }, [chosen, supabase]);

  return useMemo(() => {
    const artTags = { ...tags.artTags };
    for (const [oracleId, art] of Object.entries(chosen)) if (byArt[art]) artTags[oracleId] = byArt[art];
    return { ...tags, artTags };
  }, [tags, chosen, byArt]);
}
