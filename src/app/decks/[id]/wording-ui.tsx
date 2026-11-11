"use client";

// Search by wording (v2, Nov 10, 2026): select a phrase in a card's rules text and search for it, or tap a phrase
// cut from the text. Both open the Search panel with a Scryfall rules-text search (o:"…", the card's name as ~).

import { useEffect, useRef, useState } from "react";
import { fetchCardDetails, type CardDetails } from "@/lib/scryfall/card-details";
import { selectionPhrase, wordingPhrases, wordingQuery } from "@/lib/search/wording";
import type { CardSummary } from "@/lib/deck/model";

const cardText = (details: CardDetails) => details.faces.map((f) => f.oracleText).join("\n");

/** Under the rules text in the card sheet: a search button for selected text, then the card's phrases. */
export function WordingSearch({
  rulesRef,
  card,
  details,
  onSearch,
}: {
  /** The element holding the rules text; only selections inside it count. */
  rulesRef: React.RefObject<HTMLElement | null>;
  card: CardSummary;
  details?: CardDetails;
  onSearch: (query: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      const sel = document.getSelection();
      const box = rulesRef.current;
      if (!sel || sel.isCollapsed || !box || !sel.anchorNode || !box.contains(sel.anchorNode)) return setSelected(null);
      setSelected(selectionPhrase(sel.toString(), card.name, card.type_line));
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [rulesRef, card.name, card.type_line]);

  if (!details) return null;
  const phrases = wordingPhrases(cardText(details), card.name, card.type_line, 8);
  if (!phrases.length && !selected) return null;

  return (
    <div className="space-y-2 text-sm">
      {selected ? (
        <button type="button" onClick={() => onSearch(wordingQuery(selected))} className="btn btn-gold min-h-11 w-full justify-start px-3 text-left">
          <span className="min-w-0 truncate">Search cards that say “{selected}”</span>
        </button>
      ) : (
        <p className="text-xs opacity-60">Search this wording: tap a phrase, or select any text above.</p>
      )}
      {phrases.length > 0 && <WordingChips phrases={phrases} onSearch={onSearch} />}
    </div>
  );
}

/** Tap-to-search phrases. The whole chip is the button, 44 px tall for phones. */
export function WordingChips({ phrases, active, onSearch }: { phrases: string[]; active?: string; onSearch: (query: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {phrases.map((p) => {
        const q = wordingQuery(p);
        const on = active === q;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onSearch(q)}
            aria-pressed={on}
            className={`min-h-11 rounded-full border px-3 text-left ${on ? "border-gold text-gold" : "border-foreground/20 hover:bg-foreground/10"}`}
          >
            “{p}”
          </button>
        );
      })}
    </div>
  );
}

/** Phrases from the commanders' rules text, for the Search panel (details are cached per visit). */
export function useCommanderWording(commanders: CardSummary[]): string[] {
  const key = commanders.map((c) => c.oracle_id).join(",");
  const [state, setState] = useState<{ key: string; phrases: string[] }>({ key: "", phrases: [] });
  const live = useRef(key);

  useEffect(() => {
    live.current = key;
    if (!commanders.length) return;
    Promise.all(commanders.map((c) => fetchCardDetails(c.oracle_id).then((d) => wordingPhrases(cardText(d), c.name, c.type_line, 8))))
      .then((lists) => {
        if (live.current !== key) return;
        // Each commander gets a turn, so partners both show.
        const out: string[] = [];
        for (let i = 0; out.length < 10 && lists.some((l) => l[i]); i++) for (const l of lists) if (l[i] && !out.includes(l[i])) out.push(l[i]);
        setState({ key, phrases: out });
      })
      .catch(() => live.current === key && setState({ key, phrases: [] }));
    // commanders is read through key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state.key === key ? state.phrases : [];
}
