"use client";

// Collection tracking (v2, migration 0040): your whole collection by printing, loaded a page at a time (the Data
// API returns at most 1,000 rows per request). Used by the Collection page, owned marks in decks, the unowned
// price, Search's "Only cards I own", the card sheet's buttons and bulk "Mark owned". Changes save directly.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { groupRows, rowKey, type OwnedRow } from "./collection";
import { deltaChanges } from "./locations";

const PAGE = 1000;
const COLUMNS = "id, oracle_id, printing_id, finish, quantity, printing_info, added_at";
// Binders and boxes (migration 0067) add location_id to the rows and to the unique key.
const LOCATED = `${COLUMNS}, location_id`;
const CONFLICT_OLD = "owner_id,oracle_id,printing_id,finish";
const CONFLICT = `${CONFLICT_OLD},location_id`;

/** A printing of a card in one finish (and binder, once 0067 has run): what a collection row is about. */
export type OwnedTarget = Pick<OwnedRow, "oracle_id" | "printing_id" | "finish" | "printing_info" | "location_id">;

export function useCollection(userId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Map<string, OwnedRow>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // False until migration 0067 runs: then rows have no location and saves use the old unique key.
  const [located, setLocated] = useState(true);
  const latest = useRef(rows);
  latest.current = rows;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    (async () => {
      const all = new Map<string, OwnedRow>();
      let columns = LOCATED;
      for (let from = 0; ; from += PAGE) {
        let { data, error } = await supabase.from("collection_cards").select(columns).order("id").range(from, from + PAGE - 1);
        if (error && columns === LOCATED && /location_id/.test(error.message)) {
          columns = COLUMNS;
          ({ data, error } = await supabase.from("collection_cards").select(columns).order("id").range(from, from + PAGE - 1));
        }
        if (!live) return;
        // Before migration 0040 the table doesn't exist: no marks, nothing breaks.
        if (error || !data) return setError(error?.message ?? "No answer");
        for (const r of data as unknown as OwnedRow[]) all.set(rowKey(r), r);
        if (data.length < PAGE) break;
      }
      if (!live) return;
      setLocated(columns === LOCATED);
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
      for (const change of changes) {
        const quantity = change.quantity;
        const target = located ? change.target : { ...change.target, location_id: null };
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
        upserts.push({
          owner_id: userId,
          oracle_id: target.oracle_id,
          printing_id: target.printing_id,
          finish: target.finish,
          quantity: q,
          printing_info: info,
          updated_at: now,
          ...(located ? { location_id: target.location_id ?? null } : {}),
        });
      }
      setRows(next);
      const fail = (message: string) => {
        setRows(before);
        return `Couldn't update your collection: ${message}`;
      };
      for (let i = 0; i < upserts.length; i += 500) {
        const { error } = await supabase.from("collection_cards").upsert(upserts.slice(i, i + 500), { onConflict: located ? CONFLICT : CONFLICT_OLD });
        if (error) return fail(error.message);
      }
      for (const t of deletes) {
        let q = supabase.from("collection_cards").delete().eq("oracle_id", t.oracle_id).eq("finish", t.finish);
        q = t.printing_id ? q.eq("printing_id", t.printing_id) : q.is("printing_id", null);
        if (located) q = t.location_id ? q.eq("location_id", t.location_id) : q.is("location_id", null);
        const { error } = await q;
        if (error) return fail(error.message);
      }
      return null;
    },
    [supabase, userId, located],
  );

  /**
   * Adds (or with a negative delta removes) copies of one printing in one finish. Adds go to the target's location
   * (Unsorted when it names none); removals with no location take from Unsorted first, then other binders.
   */
  const add = useCallback(
    (target: OwnedTarget, delta: number) =>
      setMany(deltaChanges([...latest.current.values()], { ...target, location_id: target.location_id ?? null }, delta, delta > 0 ? (target.location_id ?? null) : target.location_id)),
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
  const rowOf = useCallback((target: Pick<OwnedRow, "oracle_id" | "printing_id" | "finish" | "location_id">) => rows.get(rowKey(target)), [rows]);

  return { rows: list, owned, loaded, error, setMany, add, clear, reload, rowOf, located, tracking: loaded && rows.size > 0 };
}
