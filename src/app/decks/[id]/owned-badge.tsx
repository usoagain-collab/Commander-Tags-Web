"use client";

import { ownedState } from "@/lib/deck/collection";

export type OwnedMark = { have: number; exact: number; need: number };

const TITLES = {
  exact: "In your collection, this printing",
  other: "In your collection, but in another printing",
  some: (m: OwnedMark) => `You own ${m.have} of ${m.need}`,
  none: "Not in your collection",
};

/**
 * Collection tracking (v2): green ✓ when you own every copy in the printing shown, orange ✓ when you own enough
 * copies but in other printings (or printing unknown), gray "1/4" when you own only some. A label, not a button.
 */
export function OwnedBadge({ owned, chip }: { owned: OwnedMark; chip?: boolean }) {
  const state = ownedState(owned);
  const title = state === "some" ? TITLES.some(owned) : TITLES[state];
  if (state === "none") return chip ? <span title={title} className="shrink-0 text-xs opacity-60">not owned</span> : null;
  const tone = {
    exact: chip ? "bg-green-600/15 text-green-700 dark:text-green-300" : "bg-green-700 text-white",
    other: chip ? "bg-orange-500/15 text-orange-700 dark:text-orange-300" : "bg-orange-600 text-white",
    some: chip ? "bg-foreground/10 opacity-85" : "bg-neutral-700/90 text-white",
  }[state];
  return (
    <span title={title} aria-label={title} className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${chip ? "" : "font-semibold"} ${tone}`}>
      {state === "some" ? `${owned.have}/${owned.need}` : "✓"}
    </span>
  );
}
