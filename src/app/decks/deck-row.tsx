"use client";

import Link from "next/link";
import { useState } from "react";
import { ManaSymbol } from "@/components/mana-cost";
import { deleteDeck, renameDeck } from "./actions";
import { useDeckDrop } from "./use-deck-drop";

export type DeckTile = {
  id: string;
  name: string;
  updated_at: string;
  card_count: number;
  art: string | null;
  commander: string | null;
  identity: string[];
};

/** "3 days ago": easier to take in than a full date. */
function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

const WUBRG = ["W", "U", "B", "R", "G"];

export function DeckRow({ deck }: { deck: DeckTile }) {
  const [mode, setMode] = useState<"view" | "rename" | "confirm-delete">("view");
  const drop = useDeckDrop(deck.id);
  const pips = WUBRG.filter((c) => deck.identity.includes(c));

  return (
    <li
      {...drop.handlers}
      className={`panel card-lift flex flex-col overflow-hidden ${drop.over ? "outline-2 outline-dashed outline-gold" : ""}`}
    >
      <Link href={`/decks/${deck.id}`} className="relative block aspect-[16/8] overflow-hidden bg-panel-raised">
        {deck.art ? (
          <img src={deck.art} alt="" loading="lazy" className="h-full w-full object-cover object-[center_25%]" />
        ) : (
          <span className="m-3 flex h-[calc(100%-1.5rem)] items-start justify-center rounded-lg border border-dashed border-gold/50 px-4 pt-3 text-center text-sm font-medium text-gold">
            + Choose a commander
          </span>
        )}
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-panel via-panel/30 to-transparent" />
        <span className="absolute inset-x-0 bottom-0 px-4 pb-2">
          <span className="display line-clamp-2 block text-xl leading-tight">{deck.name}</span>
          {deck.commander && <span className="mt-0.5 block truncate text-sm opacity-85">{deck.commander}</span>}
        </span>
      </Link>

      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2 text-sm">
        {pips.length > 0 && (
          <span className="inline-flex gap-0.5">
            {pips.map((c) => (
              <ManaSymbol key={c} symbol={c} size={16} />
            ))}
          </span>
        )}
        <span className={deck.card_count === 100 ? "font-semibold text-green-400" : "font-medium"}>{deck.card_count} / 100</span>
        <span className="opacity-70" suppressHydrationWarning>
          {ago(deck.updated_at)}
        </span>
        {mode === "view" && (
          <span className="ml-auto flex gap-1">
            <button onClick={() => setMode("rename")} className="min-h-9 px-1.5 opacity-75 hover:opacity-100">
              Rename
            </button>
            <button onClick={() => setMode("confirm-delete")} className="min-h-9 px-1.5 text-red-400 opacity-90 hover:opacity-100">
              Delete
            </button>
          </span>
        )}
      </div>

      <span aria-hidden className="mx-4 mb-3 block h-1 overflow-hidden rounded-full bg-foreground/10">
        <span className={`block h-full ${deck.card_count === 100 ? "bg-green-400" : "bg-gold"}`} style={{ width: `${Math.min(100, deck.card_count)}%` }} />
      </span>

      {drop.status && (
        <p
          aria-live="polite"
          className={`px-4 pb-2 text-sm ${drop.status.tone === "warn" ? "text-amber-400" : drop.status.tone === "ok" ? "text-green-400" : "opacity-75"}`}
        >
          {drop.status.text}
        </p>
      )}

      {mode === "rename" && (
        <form action={renameDeck} onSubmit={() => setMode("view")} className="flex gap-2 px-4 pb-3">
          <input type="hidden" name="id" value={deck.id} />
          <input
            name="name"
            aria-label="New deck name"
            defaultValue={deck.name}
            maxLength={120}
            autoFocus
            className="min-h-10 min-w-0 flex-1 rounded-lg border border-foreground/20 bg-transparent px-2"
          />
          <button className="btn btn-gold">Save</button>
          <button type="button" onClick={() => setMode("view")} className="px-1 text-sm opacity-75">
            Cancel
          </button>
        </form>
      )}

      {mode === "confirm-delete" && (
        <form action={deleteDeck} className="flex flex-wrap items-center gap-2 px-4 pb-3 text-sm">
          <input type="hidden" name="id" value={deck.id} />
          <span>Delete this deck for good?</span>
          <button className="min-h-10 rounded-lg bg-red-600 px-3 font-medium text-white">Delete</button>
          <button type="button" onClick={() => setMode("view")} className="min-h-10 px-2 opacity-80">
            Keep it
          </button>
        </form>
      )}
    </li>
  );
}
