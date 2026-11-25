"use client";

// Binders and boxes (migration 0067): your locations, created, restyled, reordered and deleted directly (no undo,
// like My tags). Before the migration the read fails and `ready` stays false, so the page shows no binders.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { defaultStyle, readLocations, type CollectionLocation, type LocationKind, type LocationStyle } from "./locations";

export function useLocations(userId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [list, setList] = useState<CollectionLocation[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    supabase
      .from("collection_locations")
      .select("id, name, kind, style, sort")
      .then(({ data, error }) => {
        if (!live || error) return;
        setList(readLocations(data));
        setReady(true);
      });
    return () => {
      live = false;
    };
  }, [supabase, userId]);

  const create = useCallback(
    async (name: string, kind: LocationKind): Promise<CollectionLocation | string> => {
      const style = defaultStyle(kind, list.length);
      const sort = list.reduce((m, l) => Math.max(m, l.sort), 0) + 1;
      const { data, error } = await supabase.from("collection_locations").insert({ name: name.trim(), kind, style, sort }).select("id, name, kind, style, sort").single();
      if (error) return /collection_locations_name/.test(error.message) ? "You already have one with that name." : `Couldn't save it: ${error.message}`;
      const made = readLocations([data])[0];
      setList((l) => [...l, made]);
      return made;
    },
    [list, supabase],
  );

  /** Saves a new name, kind or style (the style is merged, so one field can change at a time). */
  const update = useCallback(
    async (id: string, patch: { name?: string; kind?: LocationKind; style?: Partial<LocationStyle> }) => {
      const before = list;
      const cur = list.find((l) => l.id === id);
      if (!cur) return "That binder is gone.";
      const next: CollectionLocation = { ...cur, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.kind ? { kind: patch.kind } : {}), style: { ...cur.style, ...patch.style } };
      setList((l) => l.map((x) => (x.id === id ? next : x)));
      const { error } = await supabase.from("collection_locations").update({ name: next.name, kind: next.kind, style: next.style }).eq("id", id);
      if (error) {
        setList(before);
        return /collection_locations_name/.test(error.message) ? "You already have one with that name." : `Couldn't save that: ${error.message}`;
      }
      return null;
    },
    [list, supabase],
  );

  /** Moves a location one step earlier (-1) or later (+1) in the chips. */
  const reorder = useCallback(
    async (id: string, step: -1 | 1) => {
      const i = list.findIndex((l) => l.id === id);
      const j = i + step;
      if (i < 0 || j < 0 || j >= list.length) return null;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      const renumbered = next.map((l, k) => ({ ...l, sort: k + 1 }));
      const before = list;
      setList(renumbered);
      const changed = renumbered.filter((l) => before.find((b) => b.id === l.id)?.sort !== l.sort);
      for (const l of changed) {
        const { error } = await supabase.from("collection_locations").update({ sort: l.sort }).eq("id", l.id);
        if (error) {
          setList(before);
          return `Couldn't save the order: ${error.message}`;
        }
      }
      return null;
    },
    [list, supabase],
  );

  /** Deletes a location; its copies join Unsorted on the server. Returns how many copies moved, or a message. */
  const remove = useCallback(
    async (id: string): Promise<number | string> => {
      const { data, error } = await supabase.rpc("delete_collection_location", { p_id: id });
      if (error) return `Couldn't delete it: ${error.message}`;
      setList((l) => l.filter((x) => x.id !== id));
      return (data as number) ?? 0;
    },
    [supabase],
  );

  return { list, ready, create, update, reorder, remove };
}
