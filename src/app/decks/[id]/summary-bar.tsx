"use client";

import { groupByType, type DeckLine } from "@/lib/deck/model";
import { isLand } from "@/lib/tags/roles";

/**
 * Sticky bar at the bottom: deck size, counts by card type, and today's total price.
 * The land count includes modal double-faced cards with a land face (they can be played as lands),
 * even though they're listed under their front face's type.
 */
export function SummaryBar({ deckLines, size, price }: { deckLines: DeckLine[]; size: number; price: number }) {
  const types = groupByType(deckLines).filter((g) => g.section !== "Land");
  const lands = deckLines.filter((l) => l.card.counts_as_land).reduce((n, l) => n + l.quantity, 0);
  const mdfc = deckLines.filter((l) => l.card.counts_as_land && !isLand(l.card.type_line)).reduce((n, l) => n + l.quantity, 0);
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
        {lands > 0 && (
          <span className="opacity-70" title={mdfc ? `${mdfc} modal double-faced card(s) with a land face count as lands` : undefined}>
            Land {lands}
            {mdfc > 0 && ` (incl. ${mdfc} MDFC)`}
          </span>
        )}
        <span className="ml-auto tabular-nums opacity-70">${price.toFixed(2)}</span>
      </div>
    </div>
  );
}
