"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  applyChange,
  BOARD_LABELS,
  deckIdentity,
  deckSize,
  groupByType,
  linesFor,
  outsideIdentity,
  planAdd,
  planMove,
  planSetQuantity,
  toSaveRows,
  totalPrice,
  type Board,
  type CardSummary,
  type Change,
  type Entries,
  type Plan,
} from "@/lib/deck/model";
import { useAutosave, type SaveStatus } from "@/lib/deck/use-autosave";
import { CardLine } from "./card-line";
import { QuickAdd, type QuickAddHandle } from "./quick-add";

type State = {
  entries: Entries;
  cards: Record<string, CardSummary>;
  past: Change[]; // undo stack
  future: Change[]; // redo stack
};

type Action =
  | { type: "apply"; change: Change; card?: CardSummary }
  | { type: "undo" }
  | { type: "redo" };

const HISTORY_LIMIT = 200;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "apply":
      return {
        entries: applyChange(state.entries, action.change),
        cards: action.card ? { ...state.cards, [action.card.oracle_id]: action.card } : state.cards,
        past: [...state.past, action.change].slice(-HISTORY_LIMIT),
        future: [], // a new edit clears redo, like any editor
      };
    case "undo": {
      const change = state.past.at(-1);
      if (!change) return state;
      return {
        ...state,
        entries: applyChange(state.entries, change, "back"),
        past: state.past.slice(0, -1),
        future: [...state.future, change],
      };
    }
    case "redo": {
      const change = state.future.at(-1);
      if (!change) return state;
      return {
        ...state,
        entries: applyChange(state.entries, change),
        past: [...state.past, change],
        future: state.future.slice(0, -1),
      };
    }
  }
}

type Props = {
  deck: { id: string; name: string };
  initialEntries: Entries;
  initialCards: Record<string, CardSummary>;
  readOnly: boolean;
};

export function DeckEditor({ deck, initialEntries, initialCards, readOnly }: Props) {
  const [state, dispatch] = useReducer(reducer, {
    entries: initialEntries,
    cards: initialCards,
    past: [],
    future: [],
  });
  const { status, save, retry } = useAutosave(deck.id);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<CardSummary | null>(null);
  const quickAdd = useRef<QuickAddHandle>(null);

  const say = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((m) => (m === msg ? null : m)), 4000);
  }, []);

  /** Run a planned edit: update the screen, remember it for undo, queue it for saving. */
  const run = useCallback(
    (plan: Plan, card?: CardSummary) => {
      if (!plan.ok) {
        if (plan.reason !== "No change.") say(plan.reason);
        return;
      }
      dispatch({ type: "apply", change: plan.change, card });
      save(toSaveRows(plan.change));
    },
    [save, say],
  );

  const undo = useCallback(() => {
    const change = state.past.at(-1);
    if (!change) return;
    dispatch({ type: "undo" });
    save(toSaveRows(change, "back"));
    say(`Undid: ${change.label}`);
  }, [state.past, save, say]);

  const redo = useCallback(() => {
    const change = state.future.at(-1);
    if (!change) return;
    dispatch({ type: "redo" });
    save(toSaveRows(change));
    say(`Redid: ${change.label}`);
  }, [state.future, save, say]);

  // Keyboard: Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo, "/" jumps to quick add.
  // Skipped while typing in a text box, so Ctrl+Z there still undoes typing.
  useEffect(() => {
    if (readOnly) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        quickAdd.current?.focus();
      } else if (mod && !typing && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && !typing && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly, undo, redo]);

  const { entries, cards } = state;
  const identity = deckIdentity(entries, cards);
  const size = deckSize(entries);
  const commanders = linesFor(entries, cards, "commander");
  const companions = linesFor(entries, cards, "companion");
  const main = groupByType(linesFor(entries, cards, "main"));
  const maybe = linesFor(entries, cards, "maybe").sort((a, b) => a.card.name.localeCompare(b.card.name));

  const lineProps = (line: ReturnType<typeof linesFor>[number]) => ({
    line,
    readOnly,
    offColor: outsideIdentity(line.card, identity),
    onPreview: () => setPreview(line.card),
    onMove: (to: Board) => run(planMove(entries, line.card, line.board, to)),
    onQuantity: (n: number) => run(planSetQuantity(entries, line.card, line.board, n)),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/decks" className="text-sm opacity-70 hover:underline">
            ← My decks
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{deck.name}</h1>
          <p className="mt-1 text-sm opacity-70">
            <span className={size === 100 ? "font-medium text-green-700 dark:text-green-400" : ""}>{size} / 100</span>{" "}
            cards · ${totalPrice(entries, cards).toFixed(2)}
            {identity && <> · identity {identity.size ? [...identity].join("") : "colorless"}</>}
          </p>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-3 text-sm">
            <SaveIndicator status={status} onRetry={retry} />
            <button
              onClick={undo}
              disabled={state.past.length === 0}
              title="Undo (Ctrl+Z)"
              className="rounded-md border border-foreground/20 px-2.5 py-1 disabled:opacity-40"
            >
              Undo
            </button>
            <button
              onClick={redo}
              disabled={state.future.length === 0}
              title="Redo (Ctrl+Shift+Z)"
              className="rounded-md border border-foreground/20 px-2.5 py-1 disabled:opacity-40"
            >
              Redo
            </button>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          {!readOnly && (
            <QuickAdd
              ref={quickAdd}
              onAdd={(card, board) => run(planAdd(entries, card, board), card)}
              onPreview={setPreview}
            />
          )}
          <p aria-live="polite" className="mt-2 min-h-5 text-sm text-amber-700 dark:text-amber-400">
            {notice}
          </p>

          <Section title={BOARD_LABELS.commander} count={commanders.length}>
            {commanders.length === 0 ? (
              <p className="px-1.5 py-1 text-sm opacity-60">
                No commander yet. Add a legendary creature with Ctrl+Enter, or use ♛ on a card below.
              </p>
            ) : (
              <ul>{commanders.map((l) => <CardLine key={l.card.oracle_id} {...lineProps(l)} />)}</ul>
            )}
          </Section>

          {companions.length > 0 && (
            <Section title={BOARD_LABELS.companion} count={companions.length}>
              <ul>{companions.map((l) => <CardLine key={l.card.oracle_id} {...lineProps(l)} />)}</ul>
            </Section>
          )}

          <Section title={BOARD_LABELS.main} count={main.reduce((n, g) => n + g.count, 0)}>
            {main.length === 0 && <p className="px-1.5 py-1 text-sm opacity-60">Empty. Add cards above.</p>}
            <div className="columns-1 gap-8 xl:columns-2">
              {main.map((g) => (
                <div key={g.section} className="mb-4 break-inside-avoid">
                  <h3 className="mb-1 px-1.5 text-xs font-semibold uppercase tracking-wide opacity-60">
                    {g.section} ({g.count})
                  </h3>
                  <ul>{g.lines.map((l) => <CardLine key={l.card.oracle_id} {...lineProps(l)} />)}</ul>
                </div>
              ))}
            </div>
          </Section>

          <Section title={BOARD_LABELS.maybe} count={maybe.reduce((n, l) => n + l.quantity, 0)}>
            {maybe.length === 0 ? (
              <p className="px-1.5 py-1 text-sm opacity-60">Cards you&apos;re considering. Shift+Enter adds here.</p>
            ) : (
              <ul>{maybe.map((l) => <CardLine key={l.card.oracle_id} {...lineProps(l)} />)}</ul>
            )}
          </Section>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-6">
            {preview?.image_normal ? (
              <img
                src={preview.image_normal}
                alt={preview.name}
                width={280}
                height={390}
                className="w-full rounded-[4.75%/3.5%] shadow-lg"
              />
            ) : (
              <div className="flex aspect-[63/88] w-full items-center justify-center rounded-xl border border-dashed border-foreground/20 p-6 text-center text-sm opacity-50">
                {preview ? preview.name : "Hover a card to see it here"}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 border-b border-foreground/10 pb-1 font-semibold">
        {title} <span className="font-normal opacity-60">({count})</span>
      </h2>
      {children}
    </section>
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status.state === "error") {
    return (
      <span className="flex items-center gap-2 text-red-600" title={status.error}>
        Not saved ({status.pending} {status.pending === 1 ? "change" : "changes"})
        <button onClick={onRetry} className="rounded border border-red-600/40 px-2 py-0.5">
          Retry
        </button>
      </span>
    );
  }
  return (
    <span className="opacity-60" aria-live="polite">
      {status.state === "saving" ? "Saving…" : "All changes saved"}
    </span>
  );
}
