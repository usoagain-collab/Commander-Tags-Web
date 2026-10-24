// Opening-hand stats (Phase 6d, shown in the editor's Stats panel): shuffle the library many times and look at
// the first cards. Lands count by counts_as_land (MDFCs too); "Ramp" uses the same role rules as the profile.
// Seeded, so the numbers stay put while the deck doesn't change.
import { shuffled } from "@/lib/playtest/game";

export type HandCard = { land: boolean; ramp: boolean; quantity: number };

export type HandStats = {
  hands: number;
  /** Share of 7-card hands with exactly 0..7 lands. */
  landSpread: number[];
  averageLands: number;
  /** Share of hands with 2 to 4 lands (a common "keepable" range). */
  keepable: number;
  /** Chance of seeing at least one Ramp card by turn 2: on the play (8 cards seen), on the draw (9). */
  rampByTurn2: { play: number; draw: number };
  /** Ramp cards in the library, for context. */
  rampCards: number;
};

export function handStats(library: HandCard[], hands = 1000, seed = 20261024): HandStats {
  const cards: HandCard[] = library.flatMap((c) => Array.from({ length: c.quantity }, () => c));
  const spread = new Array(8).fill(0);
  let lands = 0;
  let rampPlay = 0;
  let rampDraw = 0;
  let s = seed;
  if (cards.length < 9) {
    return { hands: 0, landSpread: spread, averageLands: 0, keepable: 0, rampByTurn2: { play: 0, draw: 0 }, rampCards: cards.filter((c) => c.ramp).length };
  }
  for (let i = 0; i < hands; i++) {
    const [deck, next] = shuffled(cards, s);
    s = next;
    const hand = deck.slice(0, 7);
    const n = hand.filter((c) => c.land).length;
    spread[n]++;
    lands += n;
    if (deck.slice(0, 8).some((c) => c.ramp)) rampPlay++;
    if (deck.slice(0, 9).some((c) => c.ramp)) rampDraw++;
  }
  return {
    hands,
    landSpread: spread.map((x) => x / hands),
    averageLands: lands / hands,
    keepable: (spread[2] + spread[3] + spread[4]) / hands,
    rampByTurn2: { play: rampPlay / hands, draw: rampDraw / hands },
    rampCards: cards.filter((c) => c.ramp).length,
  };
}
