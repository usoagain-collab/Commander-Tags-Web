"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ManaCost } from "@/components/mana-cost";
import type { Board, CardSummary } from "@/lib/deck/model";

export type QuickAddHandle = { focus: () => void };

type Props = {
  onAdd: (card: CardSummary, board: Board) => void;
  onPreview: (card: CardSummary | null) => void;
};

/** Type a card name, pick with arrow keys. Enter = mainboard, Shift+Enter = maybeboard, Ctrl+Enter = commander. */
export const QuickAdd = forwardRef<QuickAddHandle, Props>(function QuickAdd({ onAdd, onPreview }, ref) {
  const supabase = useMemo(() => createClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const latest = useRef(0);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  // Search as you type, after a short pause; ignore answers to older queries that arrive late.
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const id = ++latest.current;
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc("search_cards", { q, lim: 8 });
      if (id !== latest.current) return;
      setResults((data ?? []) as CardSummary[]);
      setActive(0);
      setOpen(true);
    }, 120);
    return () => clearTimeout(timer);
  }, [text, supabase]);

  useEffect(() => {
    onPreview(open ? (results[active] ?? null) : null);
  }, [open, results, active, onPreview]);

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
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const board: Board = e.ctrlKey || e.metaKey ? "commander" : e.shiftKey ? "maybe" : "main";
      choose(results[active], board);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Add a card: type a name and press Enter"
        aria-label="Add a card"
        role="combobox"
        aria-expanded={open}
        aria-controls="quick-add-results"
        className="w-full rounded-md border border-foreground/20 bg-transparent px-3 py-2"
      />
      <p className="mt-1 hidden text-xs opacity-60 sm:block">
        Enter adds to the mainboard · Shift+Enter to the maybeboard · Ctrl+Enter makes it your commander · press / to
        come back here
      </p>
      {open && results.length > 0 && (
        <ul
          id="quick-add-results"
          role="listbox"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-md border border-foreground/15 bg-background shadow-lg"
        >
          {results.map((card, i) => (
            <li
              key={card.oracle_id}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(card, "main");
              }}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm ${
                i === active ? "bg-foreground/10" : ""
              }`}
            >
              <span className="min-w-0 truncate">
                {card.name}
                <span className="ml-2 text-xs opacity-50">{card.type_line.split(" — ")[0]}</span>
              </span>
              <ManaCost cost={card.mana_cost} />
            </li>
          ))}
        </ul>
      )}
      {open && text.trim().length >= 2 && results.length === 0 && (
        <p className="absolute z-20 mt-1 w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm opacity-70 shadow-lg">
          No Commander-legal card matches “{text.trim()}”.
        </p>
      )}
    </div>
  );
});
