"use client";

// Collection tracking (v2, migration 0038): your whole collection, loaded a page at a time (the Data API
// returns at most 1,000 rows per request). Used for owned marks in decks, the unowned price, Search's
// "Hide cards I don't own" and the card sheet's counter, which saves directly.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Collection, Owned } from "./collection";

const PAGE = 1000;

export function useCollection(userId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [owned, setOwned] = useState<Collection>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    (async () => {
      const all = new Map<string, Owned>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("collection")
          .select("oracle_id, quantity, foil_quantity")
          .order("oracle_id")
          .range(from, from + PAGE - 1);
        // Before migration 0038 the table doesn't exist: no marks, nothing breaks.
        if (error || !live) return;
        for (const r of data as ({ oracle_id: string } & Owned)[]) all.set(r.oracle_id, { quantity: r.quantity, foil_quantity: r.foil_quantity });
        if (data.length < PAGE) break;
      }
      if (live) {
        setOwned(all);
        setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [supabase, userId]);

  /** Sets how many plain copies you own (0 removes the card unless you own foils). */
  const setQuantity = useCallback(
    async (oracleId: string, quantity: number) => {
      if (!userId) return "Sign in to track your collection.";
      const before = owned.get(oracleId);
      const next: Owned = { quantity: Math.max(0, Math.min(9999, quantity)), foil_quantity: before?.foil_quantity ?? 0 };
      setOwned((m) => {
        const copy = new Map(m);
        if (next.quantity + next.foil_quantity === 0) copy.delete(oracleId);
        else copy.set(oracleId, next);
        return copy;
      });
      const res =
        next.quantity + next.foil_quantity === 0
          ? await supabase.from("collection").delete().eq("oracle_id", oracleId)
          : await supabase.from("collection").upsert({ owner_id: userId, oracle_id: oracleId, ...next, updated_at: new Date().toISOString() });
      if (res.error) {
        setOwned((m) => {
          const copy = new Map(m);
          if (before) copy.set(oracleId, before);
          else copy.delete(oracleId);
          return copy;
        });
        return `Couldn't update your collection: ${res.error.message}`;
      }
      return null;
    },
    [owned, supabase, userId],
  );

  return { owned, loaded, setQuantity, tracking: loaded && owned.size > 0 };
}
