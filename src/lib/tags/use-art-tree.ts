"use client";

// The art-tag tree for just the deck's art tags and their ancestors (SQL: art_tag_ancestry). Only fetched once
// the top-tags panel is in Flavor mode, since Gameplay never shows art tags.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { artTreeFrom } from "./themes";
import type { TagTree } from "./tree";

export function useArtTree(artSlugs: string[], artN: number | undefined, enabled: boolean): TagTree | null {
  const supabase = useMemo(() => createClient(), []);
  const [tree, setTree] = useState<TagTree | null>(null);
  const key = [...new Set(artSlugs)].sort().join(",");

  useEffect(() => {
    if (!enabled || artN === undefined || !key) return;
    let live = true;
    void (async () => {
      const { data } = await supabase.rpc("art_tag_ancestry", { slugs: key.split(",") });
      if (live && data) setTree(artTreeFrom(data as [string, string, number, string[]][], artN));
    })();
    return () => {
      live = false;
    };
  }, [key, artN, enabled, supabase]);

  return enabled ? tree : null;
}
