"use client";

// My decks: the tiles, with search and sort once the list is long enough to need them (stress test, Nov 2026).
import { useEffect, useState } from "react";
import { DeckRow, type DeckTile } from "./deck-row";

type Sort = "recent" | "name" | "size";
const SORT_KEY = "decks:sort";
/** Fewer decks than this fit on a screen or two; the controls would only be clutter. */
const CONTROLS_FROM = 7;

export function DeckList({ decks }: { decks: DeckTile[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSortState] = useState<Sort>("recent");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SORT_KEY);
      if (saved === "name" || saved === "size") setSortState(saved);
    } catch {}
  }, []);
  function setSort(s: Sort) {
    setSortState(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {}
  }

  const q = query.trim().toLowerCase();
  const shown = decks
    .filter((d) => !q || d.name.toLowerCase().includes(q) || (d.commander ?? "").toLowerCase().includes(q))
    .sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "size" ? b.card_count - a.card_count || a.name.localeCompare(b.name) : b.updated_at.localeCompare(a.updated_at),
    );

  return (
    <>
      {decks.length >= CONTROLS_FROM && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by deck or commander…"
            aria-label="Search my decks"
            className="min-h-11 w-full rounded-lg border border-foreground/20 bg-transparent px-3 sm:w-80"
          />
          <label className="flex items-center gap-2 text-sm">
            <span className="opacity-80">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-h-11 rounded-lg border border-foreground/20 bg-background px-2">
              <option value="recent">Last edited</option>
              <option value="name">Name</option>
              <option value="size">Most cards</option>
            </select>
          </label>
          {q && <span className="text-sm opacity-70">{shown.length} of {decks.length}</span>}
        </div>
      )}
      {shown.length === 0 && <p className="mt-4 opacity-70">No deck matches “{query}”.</p>}
      <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((d) => (
          <DeckRow key={d.id} deck={d} />
        ))}
      </ul>
    </>
  );
}
