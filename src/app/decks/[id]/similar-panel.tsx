"use client";

// Similar decks (V3): public decks with this deck's commander, most cards in common first. Compare opens the
// two side by side.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadSimilarCandidates, rankSimilar, type SimilarDeck } from "@/lib/deck/similar";
import type { CompareRow } from "@/lib/deck/compare";
import type { CardSummary } from "@/lib/deck/model";
import { Panel } from "./deck-text-panel";

type Props = {
  deckId: string;
  rows: CompareRow[];
  cards: Record<string, CardSummary>;
  commanders: { oracle_id: string; name: string }[];
  onCompare: (deck: { id: string; name: string }) => void;
  onClose: () => void;
};

export function SimilarPanel({ deckId, rows, cards, commanders, onCompare, onClose }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [found, setFound] = useState<SimilarDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commanderKey = commanders.map((c) => c.oracle_id).sort().join(",");

  useEffect(() => {
    if (!commanderKey) return;
    let live = true;
    setFound(null);
    loadSimilarCandidates(supabase, deckId, commanderKey.split(","))
      .then((candidates) => {
        if (!live) return;
        const isBasic = (id: string) => /\bBasic\b/.test(cards[id]?.type_line ?? "");
        setFound(rankSimilar(rows, candidates, isBasic));
        setError(null);
      })
      .catch((e: Error) => live && setError(`Couldn't look for similar decks: ${e.message}`));
    return () => {
      live = false;
    };
    // Ranked once when the panel opens: re-reading 60 decks on every edit would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, deckId, commanderKey]);

  return (
    <Panel title="Similar decks" onClose={onClose}>
      {!commanders.length ? (
        <p className="text-sm opacity-80">Add a commander, and this finds public decks built around the same one.</p>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : !found ? (
        <p className="text-sm opacity-60">Looking at public decks with {commanders.map((c) => c.name).join(" and ")}…</p>
      ) : (
        <>
          {found.length === 0 ? (
            <p className="text-sm opacity-80">No other public deck with this commander shares cards with this one yet.</p>
          ) : (
            <>
              <p className="mb-3 text-sm opacity-80">Public decks with the same commander, most cards in common first (basic lands not counted).</p>
              <ul className="space-y-2">
                {found.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-foreground/10 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <Link href={`/decks/${d.id}`} className="font-medium hover:underline">
                        {d.name}
                      </Link>
                      {d.precon && <span className="ml-2 rounded bg-foreground/10 px-1.5 py-0.5 text-xs">Precon</span>}
                      <p className="text-xs opacity-70">
                        Runs {Math.round(d.overlap * 100)}% of this deck&rsquo;s cards ({d.shared} {d.shared === 1 ? "card" : "cards"})
                      </p>
                    </div>
                    <button type="button" className="btn min-h-11" onClick={() => onCompare({ id: d.id, name: d.name })}>
                      Compare
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {commanders.length === 1 && (
            <p className="mt-3 text-sm">
              <Link href={`/commanders/${commanders[0].oracle_id}`} className="underline">
                Every public deck with {commanders[0].name}
              </Link>
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
