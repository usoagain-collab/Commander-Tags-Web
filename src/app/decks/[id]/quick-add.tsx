"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ManaCost } from "@/components/mana-cost";
import type { Board, CardSummary } from "@/lib/deck/model";

export type QuickAddHandle = { focus: () => void };

type Props = {
  onAdd: (card: CardSummary, board: Board) => void;
  onPreview: (card: CardSummary | null) => void;
  /** Picking a commander: only cards that can lead a deck are offered, shown with their art. */
  commanderOnly?: boolean;
  /** The commander's colors: only cards inside them are offered. Null = any colors. */
  identity?: Set<string> | null;
  /** "See all results": hands the typed text to the full Search panel. */
  onSeeAll?: (text: string) => void;
};

/** Type a card name, pick with arrow keys. Enter = mainboard, Shift+Enter = maybeboard, Ctrl+Enter = commander. */
export const QuickAdd = forwardRef<QuickAddHandle, Props>(function QuickAdd({ onAdd, onPreview, commanderOnly, identity, onSeeAll }, ref) {
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const latest = useRef(0);
  // What the shown results are for, and a board waiting on them: Enter can arrive before the search answers.
  const answered = useRef("");
  const pendingBoard = useRef<Board | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  // A string, so a new Set with the same colors on each render doesn't re-run the search.
  const colors = commanderOnly || !identity ? null : [...identity].sort().join("");

  // Search as you type, after a short pause; ignore answers to older queries that arrive late.
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const id = ++latest.current;
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc("search_cards", {
        q,
        lim: commanderOnly ? 25 : 15,
        p_identity: colors === null ? null : colors.split(""),
      });
      if (id !== latest.current) return;
      const found = (data ?? []) as CardSummary[];
      const usable = commanderOnly ? found.filter((c) => c.can_be_commander).slice(0, 15) : found;
      answered.current = q;
      const waiting = pendingBoard.current;
      pendingBoard.current = null;
      if (waiting && usable[0]) return choose(usable[0], waiting);
      setResults(usable);
      setActive(0);
      setOpen(true);
    }, 120);
    return () => clearTimeout(timer);
    // choose only touches this box and calls onAdd; re-running the search for a new onAdd would be wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, supabase, commanderOnly, colors]);

  useEffect(() => {
    onPreview(open ? (results[active] ?? null) : null);
  }, [open, results, active, onPreview]);

  // The "See all results" row sits after the cards, so the arrow keys can reach it too.
  const seeAllAt = onSeeAll ? results.length : -1;

  function seeAll() {
    if (!onSeeAll) return;
    onSeeAll(text.trim());
    setText("");
    setResults([]);
    setOpen(false);
  }

  function choose(card: CardSummary | undefined, board: Board) {
    if (!card) return;
    onAdd(card, board);
    setText("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, seeAllAt)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const board: Board = commanderOnly || e.ctrlKey || e.metaKey ? "commander" : e.shiftKey ? "maybe" : "main";
      if (answered.current === text.trim()) {
        if (active === seeAllAt) seeAll();
        else choose(results[active], board);
      }
      else if (text.trim().length >= 2) pendingBoard.current = board;
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div data-preview-card className="relative">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={commanderOnly ? "Type a commander's name" : "Add a card by name"}
        aria-label={commanderOnly ? "Pick a commander" : "Add a card"}
        role="combobox"
        aria-expanded={open}
        aria-controls="quick-add-results"
        className="min-h-12 w-full rounded-lg border border-foreground/25 bg-background/60 px-3 text-base"
      />
      {!commanderOnly && (
        <p className="mt-1 hidden text-[13px] opacity-75 lg:block" title="Press / to come back to this box">
          Enter: main · Shift+Enter: maybe · Ctrl+Enter: commander
        </p>
      )}
      {open && (results.length > 0 || (onSeeAll && answered.current === text.trim() && text.trim().length >= 2)) && (
        <ul
          id="quick-add-results"
          role="listbox"
          className="absolute z-30 mt-1 max-h-96 w-full overflow-auto rounded-lg border border-foreground/15 bg-panel-raised text-left shadow-2xl"
        >
          {results.map((card, i) => (
            <li
              key={card.oracle_id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(card, commanderOnly ? "commander" : "main");
              }}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm ${
                i === active ? "bg-foreground/10" : ""
              }`}
            >
              {card.image_art_crop && <img src={card.image_art_crop} alt="" loading="lazy" className="h-9 w-12 shrink-0 rounded object-cover" />}
              <span className="min-w-0 flex-1 truncate">
                {card.name}
                <span className="ml-2 text-[13px] opacity-65">{card.type_line.split(" — ")[0]}</span>
              </span>
              <ManaCost cost={card.mana_cost} />
            </li>
          ))}
          {onSeeAll && results.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-sm opacity-80">
              No card named like that{colors !== null ? " in your commander's colors" : ""}.
            </li>
          )}
          {onSeeAll && (
            <li
              role="option"
              aria-selected={active === seeAllAt}
              onMouseEnter={() => setActive(seeAllAt)}
              onMouseDown={(e) => {
                e.preventDefault();
                seeAll();
              }}
              className={`flex min-h-11 cursor-pointer items-center border-t border-foreground/10 px-3 py-1.5 text-sm text-gold ${
                active === seeAllAt ? "bg-foreground/10" : ""
              }`}
            >
              See all results for “{text.trim()}” →
            </li>
          )}
        </ul>
      )}
      {open && text.trim().length >= 2 && results.length === 0 && !onSeeAll && (
        <p className="absolute z-30 mt-1 w-full rounded-lg border border-foreground/15 bg-panel-raised px-3 py-2 text-sm shadow-2xl">
          No Commander-legal card matches “{text.trim()}”{colors !== null ? " in your commander's colors" : ""}.
        </p>
      )}
    </div>
  );
});
