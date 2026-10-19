"use client";

import { useBlockStrayDrops } from "./use-deck-drop";

/** The "My decks" tip about dragging, plus the guard that keeps a missed drop from leaving the page. */
export function DropHint() {
  useBlockStrayDrops();
  return (
    <p className="mt-2 text-xs opacity-60">
      Tip: drag a card image from a Scryfall tab onto a deck below to add it to that deck&apos;s mainboard.
    </p>
  );
}
