// Deck descriptions, comments and likes (V3, migration 0059). Everything reads through deck_social() and writes
// through its sibling functions, because other people's link-shared decks are hidden from a plain select. Until the
// migration runs, the owner can still write a description (decks.description already exists); comments and likes
// stay hidden.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const DESCRIPTION_MAX = 1000;
export const COMMENT_MAX = 1000;
export const HELP_NOTE_MAX = 200;

export type DeckComment = {
  id: string;
  body: string;
  created_at: string;
  author: string | null;
  avatar_url: string | null;
  is_owner: boolean;
  mine: boolean;
  can_delete: boolean;
};

export type DeckSocialData = {
  description: string | null;
  comments_open: boolean;
  likes: number;
  liked: boolean;
  comments: DeckComment[];
  /** Needs help flag (migration 0060). null when the server doesn't send it yet. */
  help: { on: boolean; note: string | null } | null;
};

/** A description ready to save: line ends kept, runs of blank lines folded to one, trimmed, capped. Empty is none. */
export function cleanDescription(raw: string | null | undefined): string | null {
  const t = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, DESCRIPTION_MAX)
    .trim();
  return t || null;
}

/** A comment ready to send, or null when there is nothing to send. Same folding as descriptions. */
export function cleanComment(raw: string | null | undefined): string | null {
  const t = cleanDescription(raw);
  return t ? t.slice(0, COMMENT_MAX).trim() : null;
}

/** Reads the server's answer defensively; anything malformed comes back empty rather than throwing. */
export function readSocial(raw: unknown): DeckSocialData | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const comments = Array.isArray(r.comments)
    ? r.comments.flatMap((c): DeckComment[] => {
        if (!c || typeof c !== "object") return [];
        const x = c as Record<string, unknown>;
        if (typeof x.id !== "string" || typeof x.body !== "string") return [];
        return [
          {
            id: x.id,
            body: x.body,
            created_at: typeof x.created_at === "string" ? x.created_at : new Date(0).toISOString(),
            author: typeof x.author === "string" && x.author.trim() ? x.author : null,
            avatar_url: typeof x.avatar_url === "string" ? x.avatar_url : null,
            is_owner: x.is_owner === true,
            mine: x.mine === true,
            can_delete: x.can_delete === true,
          },
        ];
      })
    : [];
  return {
    description: typeof r.description === "string" && r.description.trim() ? r.description : null,
    comments_open: r.comments_open !== false,
    likes: Math.max(0, Number(r.likes) || 0),
    liked: r.liked === true,
    comments,
    help:
      typeof r.needs_help === "boolean"
        ? { on: r.needs_help, note: r.needs_help ? cleanHelpNote(typeof r.help_note === "string" ? r.help_note : null) : null }
        : null,
  };
}

/** The ask beside a feedback request: one line, trimmed, capped. Empty is none. */
export function cleanHelpNote(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, HELP_NOTE_MAX).trim();
  return t || null;
}

/** "1 like", "12 likes". */
export function likeLabel(n: number) {
  return `${n} ${n === 1 ? "like" : "likes"}`;
}

/** Postgres raises our own plain sentences; show those, and a general line for anything technical. */
export function friendlyError(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  const ours = /^(Sign in|Write something|Comments (are|can)|That deck|That is a lot|You can not)/.test(message);
  return ours ? message : fallback;
}

export type DeckSocial = {
  /** null while loading; false before migration 0059 runs (description still works for the owner). */
  available: boolean | null;
  data: DeckSocialData;
  saveDescription: (text: string) => Promise<string | null>;
  setCommentsOpen: (open: boolean) => Promise<string | null>;
  /** Ask for feedback (opens comments too) or stop asking. */
  setHelp: (on: boolean, note: string) => Promise<string | null>;
  toggleLike: () => Promise<string | null>;
  addComment: (text: string) => Promise<string | null>;
  removeComment: (id: string) => Promise<string | null>;
};

const EMPTY: DeckSocialData = { description: null, comments_open: true, likes: 0, liked: false, comments: [], help: null };

export function useDeckSocial(deckId: string, owner: boolean, enabled: boolean): DeckSocial {
  const supabase = useMemo(() => createClient(), []);
  const [available, setAvailable] = useState<boolean | null>(enabled ? null : false);
  const [data, setData] = useState<DeckSocialData>(EMPTY);

  const reload = useCallback(async () => {
    const { data: raw, error } = await supabase.rpc("deck_social", { p_id: deckId });
    if (!error) {
      setData(readSocial(raw) ?? EMPTY);
      setAvailable(true);
      return;
    }
    setAvailable(false);
    // Before the migration: the owner still sees and edits the description.
    if (owner) {
      const { data: row } = await supabase.from("decks").select("description").eq("id", deckId).maybeSingle();
      setData({ ...EMPTY, description: cleanDescription(row?.description as string | null | undefined) });
    }
  }, [supabase, deckId, owner]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const saveDescription = useCallback(
    async (text: string) => {
      const description = cleanDescription(text);
      const { error } = await supabase.from("decks").update({ description }).eq("id", deckId);
      if (error) return `Couldn't save the description: ${error.message}`;
      setData((d) => ({ ...d, description }));
      return null;
    },
    [supabase, deckId],
  );

  const setCommentsOpen = useCallback(
    async (open: boolean) => {
      const { error } = await supabase.from("decks").update({ comments_open: open }).eq("id", deckId);
      if (error) return `Couldn't change comments: ${error.message}`;
      setData((d) => ({ ...d, comments_open: open }));
      return null;
    },
    [supabase, deckId],
  );

  const setHelp = useCallback(
    async (on: boolean, raw: string) => {
      const note = on ? cleanHelpNote(raw) : null;
      const change = on ? { needs_help: true, help_note: note, comments_open: true } : { needs_help: false, help_note: null };
      const { error } = await supabase.from("decks").update(change).eq("id", deckId);
      if (error) return `Couldn't save: ${error.message}`;
      setData((d) => ({ ...d, help: { on, note }, comments_open: on ? true : d.comments_open }));
      return null;
    },
    [supabase, deckId],
  );

  const toggleLike = useCallback(async () => {
    const on = !data.liked;
    setData((d) => ({ ...d, liked: on, likes: Math.max(0, d.likes + (on ? 1 : -1)) }));
    const { data: count, error } = await supabase.rpc("set_deck_like", { p_deck: deckId, p_on: on });
    if (error) {
      setData((d) => ({ ...d, liked: !on, likes: Math.max(0, d.likes + (on ? -1 : 1)) }));
      return friendlyError(error.message, "Couldn't save your like.");
    }
    setData((d) => ({ ...d, likes: Math.max(0, Number(count) || 0) }));
    return null;
  }, [supabase, deckId, data.liked]);

  const addComment = useCallback(
    async (text: string) => {
      const body = cleanComment(text);
      if (!body) return "Write something first.";
      const { error } = await supabase.rpc("add_deck_comment", { p_deck: deckId, p_body: body });
      if (error) return friendlyError(error.message, "Couldn't post your comment.");
      await reload();
      return null;
    },
    [supabase, deckId, reload],
  );

  const removeComment = useCallback(
    async (id: string) => {
      const { data: gone, error } = await supabase.rpc("delete_deck_comment", { p_id: id });
      if (error || gone !== true) return "Couldn't delete that comment.";
      setData((d) => ({ ...d, comments: d.comments.filter((c) => c.id !== id) }));
      return null;
    },
    [supabase],
  );

  return { available, data, saveDescription, setCommentsOpen, setHelp, toggleLike, addComment, removeComment };
}
