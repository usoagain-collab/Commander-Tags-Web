"use client";

// Collection tracking (v2, migration 0040): your whole collection by printing, loaded a page at a time (the Data
// API returns at most 1,000 rows per request). Used by the Collection page, owned marks in decks, the unowned
// price, Search's "Only cards I own", the card sheet's buttons and bulk "Mark owned". Changes save directly.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { groupRows, rowKey, type OwnedRow } from "./collection";

const PAGE = 1000;
const COLUMNS = "id, oracle_id, printing_id, finish, quantity, printing_info, added_at";
const CONFLICT = "owner_id,oracle_id,printing_id,finish";

/** A printing of a card in one finish: what a collection row is about. */
export type OwnedTarget = Pick<OwnedRow, "oracle_id" | "printing_id" | "finish" | "printing_info">;

export function useCollection(userId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Map<string, OwnedRow>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const latest = useRef(rows);
  latest.current = rows;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    (async () => {
      const all = new Map<string, OwnedRow>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from("collection_cards").select(COLUMNS).order("id").range(from, from + PAGE - 1);
        if (!live) return;
        // Before migration 0040 the table doesn't exist: no marks, nothing breaks.
        if (error) return setError(error.message);
        for (const r of data as OwnedRow[]) all.set(rowKey(r), r);
        if (data.length < PAGE) break;
      }
      if (!live) return;
      setRows(all);
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [supabase, userId, version]);

  /**
   * Sets several rows to these quantities (0 deletes), shown at once and saved in batches. On failure the earlier
   * rows come back and the message says why. Returns null when saved.
   */
  const setMany = useCallback(
    async (changes: { target: OwnedTarget; quantity: number }[]) => {
      if (!userId) return "Sign in to track your collection.";
      const before = latest.current;
      const next = new Map(before);
      const upserts: Record<string, unknown>[] = [];
      const deletes: OwnedTarget[] = [];
      const now = new Date().toISOString();
      for (const { target, quantity } of changes) {
        const k = rowKey(target);
        const q = Math.max(0, Math.min(9999, Math.round(quantity)));
        const had = next.get(k);
        if (q === 0) {
          if (had) deletes.push(target);
          next.delete(k);
          continue;
        }
        const info = target.printing_info ?? had?.printing_info ?? null;
        next.set(k, { ...had, ...target, printing_info: info, quantity: q, added_at: had?.added_at ?? now });
        upserts.push({ owner_id: userId, oracle_id: target.oracle_id, printing_id: target.printing_id, finish: target.finish, quantity: q, printing_info: info, updated_at: now });
      }
      setRows(next);
      const fail = (message: string) => {
        setRows(before);
        return `Couldn't update your collection: ${message}`;
      };
      for (let i = 0; i < upserts.length; i += 500) {
        const { error } = await supabase.from("collection_cards").upsert(upserts.slice(i, i + 500), { onConflict: CONFLICT });
        if (error) return fail(error.message);
      }
      for (const t of deletes) {
        let q = supabase.from("collection_cards").delete().eq("oracle_id", t.oracle_id).eq("finish", t.finish);
        q = t.printing_id ? q.eq("printing_id", t.printing_id) : q.is("printing_id", null);
        const { error } = await q;
        if (error) return fail(error.message);
      }
      return null;
    },
    [supabase, userId],
  );

  /** Adds (or with a negative delta removes) copies of one printing in one finish. */
  const add = useCallback(
    (target: OwnedTarget, delta: number) => setMany([{ target, quantity: (latest.current.get(rowKey(target))?.quantity ?? 0) + delta }]),
    [setMany],
  );

  /** Clears the whole collection (Import → Replace). */
  const clear = useCallback(async () => {
    if (!userId) return "Sign in to track your collection.";
    const { error } = await supabase.from("collection_cards").delete().eq("owner_id", userId);
    if (error) return `Couldn't clear your collection: ${error.message}`;
    setRows(new Map());
    return null;
  }, [supabase, userId]);

  const list = useMemo(() => [...rows.values()], [rows]);
  const owned = useMemo(() => groupRows(list), [list]);
  const reload = useCallback(() => setVersion((n) => n + 1), []);
  const rowOf = useCallback((target: Pick<OwnedRow, "oracle_id" | "printing_id" | "finish">) => rows.get(rowKey(target)), [rows]);

  return { rows: list, owned, loaded, error, setMany, add, clear, reload, rowOf, tracking: loaded && rows.size > 0 };
}
