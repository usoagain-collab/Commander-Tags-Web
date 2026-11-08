"use client";

// Change log timeline: every card added, removed, recounted or moved, newest first, grouped by edit.
// The database records it on its own (deck_change_log, migration 0030); this only reads it.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { readTimeline, timeAgo, type LogRow, type TimelineEdit, type TimelineItem } from "@/lib/deck/change-log";
import { BOARD_LABELS, type Board } from "@/lib/deck/model";

const PAGE = 20; // edits shown at first; the database keeps the newest 150 card changes
const ITEMS = 8; // cards shown per edit before "Show all"

export function ChangeTimeline({ deckId, savedTick }: { deckId: string; savedTick: number | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [edits, setEdits] = useState<TimelineEdit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    if (savedTick === null) return;
    let live = true;
    (async () => {
      const { data, error } = await supabase
        .from("deck_change_log")
        .select("id, edit_id, changed_at, oracle_id, name, board, from_qty, to_qty")
        .eq("deck_id", deckId)
        .order("id", { ascending: false })
        .limit(150);
      if (!live) return;
      if (error) return setError(`Couldn't load the timeline: ${error.message}`);
      setError(null);
      setEdits(readTimeline((data ?? []) as LogRow[]));
    })();
    return () => {
      live = false;
    };
  }, [supabase, deckId, savedTick]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (edits === null) return <p className="text-sm opacity-60">Loading…</p>;
  if (!edits.length)
    return <p className="text-sm opacity-60">No changes yet. Every card you add, remove or move from now on shows up here.</p>;

  return (
    <div>
      <ol className="relative space-y-3 border-l border-foreground/15 pl-4">
        {edits.slice(0, shown).map((e) => (
          <EditEntry key={e.id} edit={e} />
        ))}
      </ol>
      {edits.length > shown && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="mt-3 min-h-11 rounded-lg border border-foreground/20 px-4 text-sm"
        >
          Show older changes
        </button>
      )}
    </div>
  );
}

function EditEntry({ edit }: { edit: TimelineEdit }) {
  const [open, setOpen] = useState(false);
  const items = open ? edit.items : edit.items.slice(0, ITEMS);
  return (
    <li className="relative">
      <span aria-hidden className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-gold" />
      <p className="text-xs opacity-60">
        <time dateTime={edit.at} title={new Date(edit.at).toLocaleString()}>
          {timeAgo(edit.at)}
        </time>
        {edit.items.length > 1 && (
          <>
            {" · "}
            {edit.plus > 0 && <span className="text-green-700 dark:text-green-400">+{edit.plus}</span>}
            {edit.plus > 0 && edit.minus > 0 && " / "}
            {edit.minus > 0 && <span className="text-red-400">−{edit.minus}</span>}
            {!edit.plus && !edit.minus && `${edit.items.length} cards moved`}
          </>
        )}
      </p>
      <ul className="mt-0.5 space-y-0.5 text-sm">
        {items.map((it, i) => (
          <li key={`${it.oracle_id}|${it.board}|${i}`}>
            <ItemText item={it} />
          </li>
        ))}
      </ul>
      {edit.items.length > ITEMS && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 min-h-9 text-sm text-gold">
          {open ? "Show fewer" : `Show all ${edit.items.length} cards`}
        </button>
      )}
    </li>
  );
}

const boardName = (b: Board) => BOARD_LABELS[b].toLowerCase();
const where = (b: Board) => (b === "main" ? null : <span className="opacity-60"> ({boardName(b)})</span>);

function ItemText({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "added":
      return (
        <span>
          <span className="text-green-700 dark:text-green-400">+ Added</span> {item.to > 1 && `${item.to} `}
          {item.name}
          {where(item.board)}
        </span>
      );
    case "removed":
      return (
        <span>
          <span className="text-red-400">− Removed</span> {item.from > 1 && `${item.from} `}
          {item.name}
          {where(item.board)}
        </span>
      );
    case "count":
      return (
        <span>
          {item.name}{" "}
          <span className="opacity-70">
            {item.from} → {item.to} copies
          </span>
          {where(item.board)}
        </span>
      );
    case "moved":
      return (
        <span>
          <span className="opacity-70">⇄ Moved</span> {item.qty > 1 && `${item.qty} `}
          {item.name}{" "}
          <span className="opacity-60">
            {boardName(item.fromBoard)} → {boardName(item.board)}
          </span>
        </span>
      );
  }
}
