"use client";

// About this deck, likes and comments (V3, migration 0059). Sits under the deck. The owner writes the description and
// can turn comments off; anyone signed in who can open a link-shared or public deck can like it and comment.
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/avatar";
import { timeAgo } from "@/lib/deck/change-log";
import { COMMENT_MAX, DESCRIPTION_MAX, likeLabel, useDeckSocial } from "@/lib/deck/deck-social";
import type { Visibility } from "./deck-editor";

export function DeckSocialSection({
  deckId,
  owner,
  signedIn,
  visibility,
}: {
  deckId: string;
  owner: boolean;
  signedIn: boolean;
  visibility: Visibility;
}) {
  const social = useDeckSocial(deckId, owner, true);
  const { available, data } = social;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shared = visibility !== "private";
  // A visitor sees nothing until there is something to show; before the migration that means nothing at all.
  if (available === null) return null;
  if (!owner && !available && !data.description) return null;

  async function act(fn: () => Promise<string | null>) {
    setBusy(true);
    const problem = await fn();
    setBusy(false);
    setError(problem);
    return problem;
  }

  const next = typeof window !== "undefined" ? window.location.pathname : `/decks/${deckId}`;
  const signIn = `/login?next=${encodeURIComponent(next)}`;

  return (
    <section aria-label="About this deck" className="panel mx-auto mb-8 mt-6 max-w-3xl space-y-4 p-4 text-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="display text-xl">About this deck</h2>
        {available && (owner || shared) && (
          <div className="flex items-center gap-2">
            {owner ? (
              <span className="opacity-80">♥ {likeLabel(data.likes)}</span>
            ) : signedIn ? (
              <button
                type="button"
                aria-pressed={data.liked}
                disabled={busy}
                onClick={() => act(social.toggleLike)}
                className={`btn min-h-11 px-4 ${data.liked ? "btn-gold" : ""}`}
              >
                {data.liked ? "♥ Liked" : "♡ Like"} · {data.likes}
              </button>
            ) : (
              <Link href={signIn} className="btn min-h-11 px-4">
                ♡ Sign in to like · {data.likes}
              </Link>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!(await act(() => social.saveDescription(draft)))) setEditing(false);
          }}
        >
          <label className="block">
            <span className="sr-only">Description</span>
            <textarea
              value={draft}
              maxLength={DESCRIPTION_MAX}
              rows={5}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What the deck does, how it wins, what you are still testing."
              className="w-full rounded-lg border border-foreground/20 bg-transparent p-3"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy} className="btn btn-gold min-h-11 px-4">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="btn min-h-11 px-4">
              Cancel
            </button>
            <span className="ml-auto opacity-70">
              {draft.length}/{DESCRIPTION_MAX}
            </span>
          </div>
        </form>
      ) : data.description ? (
        <div className="space-y-2">
          <p className="whitespace-pre-line leading-relaxed">{data.description}</p>
          {owner && (
            <button
              type="button"
              onClick={() => {
                setDraft(data.description ?? "");
                setEditing(true);
              }}
              className="btn min-h-11 px-4"
            >
              Edit description
            </button>
          )}
        </div>
      ) : owner ? (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
          className="btn min-h-11 px-4"
        >
          Add a description
        </button>
      ) : null}

      {available && owner && !shared && (
        <p className="opacity-75">Share the deck by link or make it public, and people who open it can like it and leave comments.</p>
      )}

      {available && (owner || shared) && (
        <div className="space-y-3 border-t border-foreground/10 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">
              Comments{data.comments.length ? ` (${data.comments.length})` : ""}
            </h3>
            {owner && (
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={data.comments_open}
                  disabled={busy}
                  onChange={(e) => act(() => social.setCommentsOpen(e.target.checked))}
                />
                Allow comments
              </label>
            )}
          </div>

          {data.comments.length === 0 && <p className="opacity-75">No comments yet.</p>}
          <ul className="space-y-3">
            {data.comments.map((c) => (
              <li key={c.id} className="flex gap-3">
                <Avatar url={c.avatar_url} name={c.author} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{c.author ?? "A Deck Genome player"}</span>
                    {c.is_owner && <span className="rounded bg-gold px-1.5 text-xs text-gold-ink">Builder</span>}
                    <span className="text-xs opacity-70">{timeAgo(c.created_at)}</span>
                  </p>
                  <p className="whitespace-pre-line break-words">{c.body}</p>
                </div>
                {c.can_delete && (
                  <button
                    type="button"
                    aria-label={c.mine ? "Delete your comment" : `Delete the comment from ${c.author ?? "this player"}`}
                    disabled={busy}
                    onClick={() => act(() => social.removeComment(c.id))}
                    className="btn min-h-11 shrink-0 px-3 text-xs"
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>

          {!data.comments_open && !owner ? (
            <p className="opacity-75">The builder has turned comments off.</p>
          ) : signedIn ? (
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!(await act(() => social.addComment(comment)))) setComment("");
              }}
            >
              <label className="block">
                <span className="sr-only">Your comment</span>
                <textarea
                  value={comment}
                  maxLength={COMMENT_MAX}
                  rows={3}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={owner ? "Reply to people who left comments." : "A card to try, a question, a game you played against it."}
                  className="w-full rounded-lg border border-foreground/20 bg-transparent p-3"
                />
              </label>
              <div className="flex items-center gap-2">
                <button type="submit" disabled={busy || !comment.trim()} className="btn btn-gold min-h-11 px-4">
                  Post comment
                </button>
                {comment.length > COMMENT_MAX - 100 && (
                  <span className="ml-auto opacity-70">
                    {comment.length}/{COMMENT_MAX}
                  </span>
                )}
              </div>
            </form>
          ) : (
            <Link href={signIn} className="btn min-h-11 px-4">
              Sign in to comment
            </Link>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
