"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ManaCost } from "@/components/mana-cost";
import type { Board, CardSummary } from "@/lib/deck/model";
import { StatusBadge } from "./card-search";

export type QuickAddHandle = { focus: () => void };

/** The commander box loads this many at a time, and the next page as the list scrolls near its end. */
const COMMANDER_PAGE = 20;

type Props = {
  /** Returns why the card wasn't added (already in the deck, a third commander…), shown under the box. */
  onAdd: (card: CardSummary, board: Board) => string | void;
  onPreview: (card: CardSummary | null) => void;
  /** Picking a commander: only cards that can lead a deck are offered, shown with their art. */
  commanderOnly?: boolean;
  /** The commander's colors: only cards inside them are offered. Null = any colors. */
  identity?: Set<string> | null;
  /** "See all results": hands the typed text to the full Search panel. */
  onSeeAll?: (text: string) => void;
  /** Also offer cards banned in Commander and cards not released yet. */
  withBanned?: boolean;
  /** Shows the "Include banned and preview cards" switch under the box (the commander picker). */
  onWithBanned?: (on: boolean) => void;
};

/** Type a card name, pick with arrow keys. Enter = mainboard, Shift+Enter = maybeboard, Ctrl+Enter = commander. */
export const QuickAdd = forwardRef<QuickAddHandle, Props>(function QuickAdd({ onAdd, onPreview, commanderOnly, identity, onSeeAll, withBanned = false, onWithBanned }, ref) {
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
  // Commander box paging: more pages may exist, and a page is on its way.
  const [hasMore, setHasMore] = useState(false);
  const loadingMore = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);
  // The results are close spellings (typo, missing apostrophe or accent), not names containing the text.
  const [fuzzy, setFuzzy] = useState(false);
  // Why the last pick wasn't added, next to the box where you're looking (the toast sits at the bottom).
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    if (!refusal) return;
    const t = window.setTimeout(() => setRefusal(null), 6000);
    return () => window.clearTimeout(t);
  }, [refusal]);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  // A string, so a new Set with the same colors on each render doesn't re-run the search.
  const colors = commanderOnly || !identity ? null : [...identity].sort().join("");

  // Search as you type, after a short pause; ignore answers to older queries that arrive late.
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setResults([]);
      setHasMore(false);
      return;
    }
    const id = ++latest.current;
    const timer = setTimeout(async () => {
      let usable = await fetchPage(q, 0);
      let close = false;
      if (!usable.length && q.length >= 3) {
        usable = await fetchFuzzy(q);
        close = usable.length > 0;
      }
      if (id !== latest.current) return;
      setFuzzy(close);
      setHasMore(!close && !!commanderOnly && usable.length === COMMANDER_PAGE);
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
  }, [text, supabase, commanderOnly, colors, withBanned]);

  /** One page of matches. The commander box asks the database for commanders only, so every row is usable. */
  async function fetchPage(q: string, offset: number) {
    const { data } = await supabase.rpc("search_cards", {
      q,
      lim: commanderOnly ? COMMANDER_PAGE : 15,
      p_identity: colors === null ? null : colors.split(""),
      p_any_legality: withBanned,
      p_commanders_only: !!commanderOnly,
      p_offset: offset,
    });
    return (data ?? []) as CardSummary[];
  }

  /** Nothing contains the text: names spelled close to it (Supabase migration 0047; empty before it is applied). */
  async function fetchFuzzy(q: string) {
    const { data, error } = await supabase.rpc("fuzzy_card_names", {
      q,
      lim: 8,
      p_identity: colors === null ? null : colors.split(""),
      p_any_legality: withBanned,
      p_commanders_only: !!commanderOnly,
    });
    return error ? [] : ((data ?? []) as CardSummary[]);
  }

  /** Commander box: the list scrolled near its end, so fetch the next page and add it below. */
  async function loadMore() {
    const q = text.trim();
    if (!hasMore || loadingMore.current || answered.current !== q) return;
    loadingMore.current = true;
    const id = latest.current;
    const next = await fetchPage(q, results.length);
    loadingMore.current = false;
    if (id !== latest.current) return; // the text changed meanwhile
    const seen = new Set(results.map((c) => c.oracle_id));
    setResults([...results, ...next.filter((c) => !seen.has(c.oracle_id))]);
    setHasMore(next.length === COMMANDER_PAGE);
  }

  // Arrow keys move past the visible rows: keep the active one in view.
  useEffect(() => {
    listRef.current?.querySelectorAll('[role="option"]')[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

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
    setRefusal(onAdd(card, board) || null);
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
      if (active >= results.length - 3) void loadMore();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const board: Board = commanderOnly || e.ctrlKey || e.metaKey ? "commander" : e.shiftKey ? "maybe" : "main";
      if (answered.current === text.trim()) {
        // With no cards found, Enter keeps the "no card" note on screen; See all stays one click away.
        if (!results.length) return;
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
        onChange={(e) => {
          setText(e.target.value);
          setRefusal(null);
        }}
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
      {refusal && (
        <p role="status" className="mt-1 text-sm text-amber-700 dark:text-amber-300">
          {refusal}
        </p>
      )}
      {onWithBanned && (
        <label className="mt-2 flex min-h-9 items-center justify-center gap-2 text-sm opacity-85" title="Also show cards banned in Commander, and new cards that aren't released yet">
          <input type="checkbox" checked={withBanned} onChange={(e) => onWithBanned(e.target.checked)} className="h-4 w-4" />
          Include banned and preview cards
        </label>
      )}
      {!commanderOnly && (
        <p className="mt-1 hidden text-[13px] opacity-75 lg:block" title="Press / to come back to this box">
          Enter: main · Shift+Enter: maybe · Ctrl+Enter: commander
        </p>
      )}
      {open && (results.length > 0 || (onSeeAll && answered.current === text.trim() && text.trim().length >= 2)) && (
        <ul
          id="quick-add-results"
          ref={listRef}
          role="listbox"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight > el.scrollHeight - 150) void loadMore();
          }}
          className="absolute z-30 mt-1 max-h-96 w-full overflow-auto rounded-lg border border-foreground/15 bg-panel-raised text-left shadow-2xl"
        >
          {fuzzy && (
            <li role="presentation" className="px-3 pt-2 pb-1 text-[13px] opacity-75">
              Nothing is named “{text.trim()}”. Did you mean:
            </li>
          )}
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
              <StatusBadge card={card} className="shrink-0" />
              <ManaCost cost={card.mana_cost} />
            </li>
          ))}
          {hasMore && (
            <li role="presentation" className="px-3 py-2 text-center text-[13px] opacity-60">
              Loading more…
            </li>
          )}
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
          No {withBanned ? "" : "Commander-legal "}card matches “{text.trim()}”{colors !== null ? " in your commander's colors" : ""}.
        </p>
      )}
    </div>
  );
});
