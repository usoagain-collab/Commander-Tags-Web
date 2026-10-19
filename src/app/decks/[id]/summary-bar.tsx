"use client";

import { groupByType, type DeckLine } from "@/lib/deck/model";

/** Sticky bar at the bottom: deck size, counts by card type, and today's total price. */
export function SummaryBar({ deckLines, size, price }: { deckLines: DeckLine[]; size: number; price: number }) {
  const types = groupByType(deckLines);
  return (
    <div
      className="sticky bottom-0 z-30 -mx-6 mt-8 border-t border-foreground/10 bg-background/95 px-6 py-2 text-sm backdrop-blur"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={size === 100 ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold"}>{size} / 100</span>
        {types.map((g) => (
          <span key={g.section} className="opacity-70">
            {g.section} {g.count}
          </span>
        ))}
        <span className="ml-auto tabular-nums opacity-70">${price.toFixed(2)}</span>
      </div>
    </div>
  );
}
