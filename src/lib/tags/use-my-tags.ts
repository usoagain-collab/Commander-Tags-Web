"use client";

// Loads this deck's My tags and edits the tags themselves (create, rename, recolor, rescope, delete).
// Putting a tag on or off a card is NOT done here: that's part of a deck edit (undoable, saved by autosave).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TagCards } from "@/lib/deck/model";
import { nameProblem, nextColor, readMyTags, sortMyTags, type MyTag, type MyTagColor, type MyTagScope } from "./my-tags";

export type MyTagPatch = { name?: string; color?: MyTagColor; scope?: MyTagScope };

export function useMyTags(deckId: string, enabled: boolean, onCards: (cards: TagCards) => void) {
  const supabase = useMemo(() => createClient(), []);
  const [tags, setTags] = useState<MyTag[]>([]);
  const [loaded, setLoaded] = useState(!enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      const { data, error } = await supabase.rpc("my_tags_for", { p_deck: deckId });
      if (!live) return;
      if (error) {
        setError(`Couldn't load your tags: ${error.message}`);
        return;
      }
      const r = readMyTags(data);
      setTags(r.tags);
      onCards(r.cards);
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
    // onCards is a dispatch wrapper; loading once per deck is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, enabled, supabase]);

  const friendly = (message: string) =>
    /duplicate|unique/i.test(message) ? "You already have a tag with that name." : `Couldn't save: ${message}`;

  /** Creates a tag. Returns the new tag, or a message saying why not. */
  const create = useCallback(
    async (name: string, scope: MyTagScope): Promise<MyTag | string> => {
      const problem = nameProblem(name, tags);
      if (problem) return problem;
      const { data, error } = await supabase
        .from("user_tags")
        .insert({ name: name.trim(), color: nextColor(tags), deck_id: scope === "deck" ? deckId : null })
        .select("id, name, color, deck_id")
        .single();
      if (error) return friendly(error.message);
      const tag = data as MyTag;
      setTags((ts) => sortMyTags([...ts, tag]));
      return tag;
    },
    [supabase, tags, deckId],
  );

  /** Renames, recolors or rescopes a tag. Returns an error message, or null when saved. */
  const update = useCallback(
    async (id: string, patch: MyTagPatch): Promise<string | null> => {
      if (patch.name !== undefined) {
        const problem = nameProblem(patch.name, tags, id);
        if (problem) return problem;
      }
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name.trim();
      if (patch.color) row.color = patch.color;
      if (patch.scope) row.deck_id = patch.scope === "deck" ? deckId : null;
      const { error } = await supabase.from("user_tags").update(row).eq("id", id);
      if (error) return friendly(error.message);
      setTags((ts) =>
        sortMyTags(
          ts.map((t) =>
            t.id === id
              ? {
                  ...t,
                  ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
                  ...(patch.color ? { color: patch.color } : {}),
                  ...(patch.scope ? { deck_id: patch.scope === "deck" ? deckId : null } : {}),
                }
              : t,
          ),
        ),
      );
      return null;
    },
    [supabase, tags, deckId],
  );

  /** Deletes a tag and its uses on every card. Returns an error message, or null when done. */
  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      const { error } = await supabase.from("user_tags").delete().eq("id", id);
      if (error) return `Couldn't delete: ${error.message}`;
      setTags((ts) => ts.filter((t) => t.id !== id));
      return null;
    },
    [supabase],
  );

  return { tags, loaded, error, create, update, remove };
}
