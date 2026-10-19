"use client";

import { useEffect, useState } from "react";
import { ManaCost, SymbolText } from "@/components/mana-cost";
import { fetchCardDetails, type CardDetails, type Legality } from "@/lib/scryfall/card-details";

/** Loads a card's details from Scryfall (cached per visit). */
export function useCardDetails(oracleId: string) {
  const [state, setState] = useState<{ id: string; details?: CardDetails; error?: string }>({ id: oracleId });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ id: oracleId });
    fetchCardDetails(oracleId)
      .then((details) => live && setState({ id: oracleId, details }))
      .catch((e: Error) => live && setState({ id: oracleId, error: e.message }));
    return () => {
      live = false;
    };
  }, [oracleId, attempt]);

  const current = state.id === oracleId ? state : { id: oracleId };
  return { ...current, retry: () => setAttempt((n) => n + 1) };
}

/** Rules text for every face, with power/toughness or loyalty, and flavor text. */
export function RulesText({ details, error, onRetry }: { details?: CardDetails; error?: string; onRetry: () => void }) {
  if (error) {
    return (
      <p className="text-sm text-amber-700 dark:text-amber-400">
        Couldn&apos;t load the card text from Scryfall.{" "}
        <button onClick={onRetry} className="underline">
          Try again
        </button>
      </p>
    );
  }
  if (!details) return <p className="text-sm opacity-60">Loading card text…</p>;
  const multi = details.faces.length > 1;
  return (
    <div className="space-y-3 rounded-lg border border-foreground/15 p-3 text-sm leading-relaxed">
      {details.faces.map((f, i) => (
        <div key={i} className={i > 0 ? "border-t border-foreground/10 pt-3" : ""}>
          {multi && (
            <div className="mb-1 flex items-start justify-between gap-2">
              <span className="font-medium">{f.name}</span>
              <ManaCost cost={f.manaCost} />
            </div>
          )}
          {multi && <p className="mb-1 text-xs opacity-70">{f.typeLine}</p>}
          {f.oracleText ? <SymbolText text={f.oracleText} /> : <p className="opacity-60">No rules text.</p>}
          {f.flavorText && <p className="mt-1.5 text-xs italic opacity-60">{f.flavorText}</p>}
          {f.stats && <p className="mt-1 text-right font-semibold tabular-nums">{f.stats}</p>}
        </div>
      ))}
    </div>
  );
}

const STATUS: Record<Legality, { mark: string; label: string; className: string }> = {
  legal: { mark: "✓", label: "Legal", className: "text-green-700 dark:text-green-400" },
  restricted: { mark: "R", label: "Restricted", className: "text-amber-700 dark:text-amber-400" },
  banned: { mark: "✕", label: "Banned", className: "text-red-600" },
  not_legal: { mark: "–", label: "Not legal", className: "opacity-40" },
};

/** One line for the header: is this card legal in Commander? */
export function CommanderLegality({ details }: { details?: CardDetails }) {
  const row = details?.legalities.find((r) => r.format === "commander");
  if (!row) return null;
  const s = STATUS[row.status];
  return (
    <p className={`text-sm ${s.className}`}>
      {s.mark} {s.label} in Commander
    </p>
  );
}

/** "Legality in all formats" and "Rulings", collapsed so a phone isn't a wall of text. */
export function LegalityAndRulings({ details }: { details?: CardDetails }) {
  if (!details) return null;
  return (
    <div className="space-y-2 text-sm">
      <details className="group rounded-lg border border-foreground/15">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 font-medium">
          Legality in all formats
          <span aria-hidden className="transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 px-3 pb-3 sm:grid-cols-3">
          {details.legalities.map((r) => {
            const s = STATUS[r.status];
            return (
              <li key={r.format} className={`flex items-center gap-1.5 ${r.format === "commander" ? "font-semibold" : ""}`}>
                <span className={`w-4 text-center ${s.className}`} title={s.label} aria-label={s.label}>
                  {s.mark}
                </span>
                {r.name}
              </li>
            );
          })}
        </ul>
      </details>

      <details className="group rounded-lg border border-foreground/15">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 font-medium">
          Rulings ({details.rulings.length})
          <span aria-hidden className="transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        {details.rulings.length === 0 ? (
          <p className="px-3 pb-3 opacity-60">No rulings for this card.</p>
        ) : (
          <ul className="space-y-3 px-3 pb-3">
            {details.rulings.map((r, i) => (
              <li key={i}>
                <p className="text-xs opacity-60">{r.date}</p>
                <SymbolText text={r.text} />
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
