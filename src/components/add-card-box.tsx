"use client";

// A name box that finds any card (banned and preview ones too) and hands back the one you pick.
// Used by Collection and Wish list.
import { useEffect, useMemo, useState } from "react";
import type { CardSummary } from "@/lib/deck/model";
import { createClient } from "@/lib/supabase/client";

export function AddCardBox({ onPick, placeholder = "＋ Add a card…", label }: { onPick: (card: CardSummary) => void; placeholder?: string; label: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [text, setText] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return setResults([]);
    let live = true;
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc("search_cards", { q, lim: 8, p_any_legality: true });
      if (live) setResults((data ?? []) as CardSummary[]);
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text, supabase]);

  return (
    <div className="relative w-full sm:w-80">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setText("")}
        placeholder={placeholder}
        aria-label={label}
        className="min-h-11 w-full rounded-md border border-foreground/20 bg-transparent px-3"
      />
      {results.length > 0 && (
        <ul className="panel absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto py-1 shadow-lg">
          {results.map((c) => (
            <li key={c.oracle_id}>
              <button
                type="button"
                onClick={() => {
                  setText("");
                  setResults([]);
                  onPick(c);
                }}
                className="flex min-h-11 w-full items-center px-3 text-left text-sm hover:bg-foreground/10"
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
