"use client";

// Loads what the tag layer needs for a deck: the shared oracle tag tree (once per page, cached daily)
// and each card's tags. Cards added later get their tags fetched as soon as they appear.
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { resolveRoles, STANDARD_ROLES, type ResolvedRole } from "./roles";
import { TagTree, type TagTreePayload } from "./tree";

export type ArtTag = [slug: string, label: string, size: number];
export type TagData = {
  tree: TagTree | null;
  roles: ResolvedRole[];
  oracleTags: Record<string, string[]>;
  artTags: Record<string, ArtTag[]>;
  /** Cards whose tags have been fetched (so "no tags" means untagged, not still loading). */
  loaded: Set<string>;
  error: string | null;
};

let treePromise: Promise<TagTree> | null = null;
function loadTree(): Promise<TagTree> {
  treePromise ??= fetch("/api/tag-tree")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Tag tree: HTTP ${r.status}`))))
    .then((p: TagTreePayload) => new TagTree(p))
    .catch((e) => {
      treePromise = null; // let a later render retry
      throw e;
    });
  return treePromise;
}

export function useTagData(oracleIds: string[]): TagData {
  const supabase = useMemo(() => createClient(), []);
  const [tree, setTree] = useState<TagTree | null>(null);
  const [oracleTags, setOracleTags] = useState<Record<string, string[]>>({});
  const [artTags, setArtTags] = useState<Record<string, ArtTag[]>>({});
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    loadTree()
      .then(setTree)
      .catch((e: Error) => setError(e.message));
  }, []);

  // Fetch tags for any card we haven't asked about yet (the whole deck at first, then each new card).
  const key = [...oracleIds].sort().join(",");
  useEffect(() => {
    const missing = oracleIds.filter((id) => !requested.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => requested.current.add(id));
    (async () => {
      for (let i = 0; i < missing.length; i += 300) {
        const chunk = missing.slice(i, i + 300);
        const { data, error } = await supabase.rpc("card_tags_for", { oracle_ids: chunk });
        if (error) {
          chunk.forEach((id) => requested.current.delete(id));
          setError(`Couldn't load card tags: ${error.message}`);
          return;
        }
        const d = data as { o: Record<string, string[]>; a: Record<string, ArtTag[]> };
        setOracleTags((prev) => ({ ...prev, ...d.o }));
        setArtTags((prev) => ({ ...prev, ...d.a }));
        setLoaded((prev) => new Set([...prev, ...chunk]));
      }
    })();
    // `key` stands in for oracleIds so the effect runs only when the set of cards changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, supabase]);

  const roles = useMemo(() => (tree ? resolveRoles(STANDARD_ROLES, tree) : []), [tree]);
  return { tree, roles, oracleTags, artTags, loaded, error };
}
