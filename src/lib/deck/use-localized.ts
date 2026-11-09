"use client";

// Card language (v2): localized pictures for the printings on screen. Known answers are read straight from
// localized_printings; the rest go to /api/localized a batch at a time, which asks Scryfall and saves them.
// Answers are kept for the visit, so moving around the site doesn't ask twice.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { localizeCard, type CardLang, type Localized } from "./card-language";
import type { CardSummary } from "./model";

const known = new Map<string, Map<string, Localized>>();
const asking = new Set<string>();
const BATCH = 100;

export function useLocalized(lang: CardLang, printingIds: (string | null | undefined)[]) {
  const supabase = useMemo(() => createClient(), []);
  const [version, setVersion] = useState(0);
  const key = [...new Set(printingIds.filter((x): x is string => !!x))].sort().join(",");

  useEffect(() => {
    if (lang === "en" || !key) return;
    const store = known.get(lang) ?? new Map<string, Localized>();
    known.set(lang, store);
    const todo = key.split(",").filter((id) => !store.has(id) && !asking.has(`${lang}|${id}`));
    if (!todo.length) return;
    todo.forEach((id) => asking.add(`${lang}|${id}`));
    let live = true;
    (async () => {
      // 1. Answers someone already looked up.
      for (let i = 0; i < todo.length; i += BATCH) {
        const { data } = await supabase.from("localized_printings").select("printing_id, localized_id, image_v").eq("lang", lang).in("printing_id", todo.slice(i, i + BATCH));
        for (const r of data ?? []) store.set(r.printing_id, r.localized_id ? { localized_id: r.localized_id, image_v: r.image_v } : null);
      }
      if (live) setVersion((n) => n + 1);
      // 2. The rest from Scryfall, through the server, until nothing is pending.
      let rest = todo.filter((id) => !store.has(id));
      for (let rounds = 0; rest.length && rounds < 40; rounds++) {
        const res = await fetch("/api/localized", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lang, ids: rest.slice(0, BATCH) }) }).catch(() => null);
        if (!res?.ok) break;
        const { found } = (await res.json()) as { found: Record<string, Localized> };
        const before = rest.length;
        for (const [id, a] of Object.entries(found)) store.set(id, a);
        rest = rest.filter((id) => !store.has(id));
        if (live) setVersion((n) => n + 1);
        if (rest.length === before) break; // no progress: try again on the next visit
      }
      todo.forEach((id) => asking.delete(`${lang}|${id}`));
    })();
    return () => {
      live = false;
    };
  }, [lang, key, supabase]);

  // A new function after each answer, so anything memoized on it redraws with the new pictures.
  return useCallback(
    (card: CardSummary) => {
      const store = known.get(lang);
      return lang === "en" || !store ? card : localizeCard(card, (id) => store.get(id));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, version],
  );
}
