"use client";

import Link from "next/link";
import { useState } from "react";
import { deleteDeck, renameDeck } from "./actions";

type Deck = { id: string; name: string; updated_at: string; card_count: number };

export function DeckRow({ deck }: { deck: Deck }) {
  const [mode, setMode] = useState<"view" | "rename" | "confirm-delete">("view");

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      {mode === "rename" ? (
        <form action={renameDeck} onSubmit={() => setMode("view")} className="flex flex-1 gap-2">
          <input type="hidden" name="id" value={deck.id} />
          <input
            name="name"
            defaultValue={deck.name}
            maxLength={120}
            autoFocus
            className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-2 py-1"
          />
          <button className="rounded-md bg-foreground px-3 py-1 text-sm text-background">Save</button>
          <button type="button" onClick={() => setMode("view")} className="text-sm opacity-70">
            Cancel
          </button>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          <Link href={`/decks/${deck.id}`} className="font-medium hover:underline">
            {deck.name}
          </Link>
          <p className="text-xs opacity-60">
            {deck.card_count} cards · edited {new Date(deck.updated_at).toLocaleString()}
          </p>
        </div>
      )}

      {mode === "view" && (
        <div className="flex gap-3 text-sm">
          <button onClick={() => setMode("rename")} className="opacity-70 hover:opacity-100">
            Rename
          </button>
          <button onClick={() => setMode("confirm-delete")} className="text-red-600 opacity-80 hover:opacity-100">
            Delete
          </button>
        </div>
      )}

      {mode === "confirm-delete" && (
        <form action={deleteDeck} className="flex items-center gap-3 text-sm">
          <input type="hidden" name="id" value={deck.id} />
          <span>Delete this deck for good?</span>
          <button className="rounded-md bg-red-600 px-3 py-1 text-white">Delete</button>
          <button type="button" onClick={() => setMode("view")} className="opacity-70">
            Keep it
          </button>
        </form>
      )}
    </li>
  );
}
