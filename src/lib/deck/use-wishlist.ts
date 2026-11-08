"use client";

// Wish list (v2, migration 0037): which cards are on your list, for the marks and buttons in the editor.
// The full list with card details lives on /wishlist. Adds and removes save directly.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useWishlist(userId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    (async () => {
      const { data, error } = await supabase.from("wishlist").select("oracle_id");
      if (!live) return;
      // Before migration 0037 the table doesn't exist: the buttons just stay off.
      if (error) return setError(error.message);
      setIds(new Set((data ?? []).map((r: { oracle_id: string }) => r.oracle_id)));
    })();
    return () => {
      live = false;
    };
  }, [supabase, userId]);

  const toggle = useCallback(
    async (oracleId: string) => {
      if (!userId) return "Sign in to keep a wish list.";
      const on = !ids.has(oracleId);
      setIds((s) => {
        const next = new Set(s);
        if (on) next.add(oracleId);
        else next.delete(oracleId);
        return next;
      });
      const res = on
        ? await supabase.from("wishlist").upsert({ owner_id: userId, oracle_id: oracleId }, { onConflict: "owner_id,oracle_id", ignoreDuplicates: true })
        : await supabase.from("wishlist").delete().eq("oracle_id", oracleId);
      if (res.error) {
        setIds((s) => {
          const next = new Set(s);
          if (on) next.delete(oracleId);
          else next.add(oracleId);
          return next;
        });
        return `Couldn't update your wish list: ${res.error.message}`;
      }
      return on ? "Added to your wish list." : "Removed from your wish list.";
    },
    [ids, supabase, userId],
  );

  return { ids, has: (id: string) => ids.has(id), toggle, ready: !error };
}
