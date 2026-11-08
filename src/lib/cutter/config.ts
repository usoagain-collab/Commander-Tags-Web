// Smart Cutter tuning (v2, docs/spec.md → "Smart Cutter (v2 design)"). Every weight and threshold the cutter
// uses lives here, so tuning means editing one file. Archetypes are in archetypes.ts.

/** Keep score components. Default weights add up to 1; power users can change them (normalized on use). */
export type CutterWeights = { coverage: number; saturation: number; weakest: number; theme: number; curve: number; popularity: number };
/**
 * Popularity (EDHREC rank, log scale) has its own weight because staples are staples for a reason (David, Nov 8, 2026:
 * Rhystic Study and Chromatic Lantern made shortlists just for costing 3). Function still carries most of the score.
 */
export const DEFAULT_WEIGHTS: CutterWeights = { coverage: 0.25, saturation: 0.2, weakest: 0.2, theme: 0.15, curve: 0.08, popularity: 0.12 };

export const CUTTER = {
  /** How many top gameplay themes count as "selected" (same as overall Suggest). */
  themeCount: 15,
  /** Saturation: a role this many cards over target counts as fully over. */
  overnessFull: 3,
  /** Saturation pressure is multiplied by this unless ALL the card's roles are over target. */
  partialOverFactor: 0.5,
  /** Score for a card in no role (saturation) or a role too small to compare (weakest in role). */
  neutral: 0.5,
  /** Weakest in role: a role needs this many cards before its cards are ranked against each other. */
  minRoleSize: 3,
  /** Weakest in role: quality = mana value + speed + flexibility, weighted like this. */
  quality: { manaValue: 0.5, speed: 0.25, flexibility: 0.25 },
  /** Speed: instants and flash cards, and permanents (engines stay on the table), score 1; sorceries this. */
  sorcerySpeed: 0.5,
  /** Curve fit: a bucket this many points (of 100) over its expected share scores 0. */
  curveExcessFull: 10,
  /**
   * Curve fit: the first this-many buckets (0-1 and 2) are never penalized. A deck that's cheap is rarely a reason to
   * cut a 1-mana cantrip (Preordain was suggested in spellslinger decks for this alone; tuning, Nov 8, 2026).
   */
  curveFreeBuckets: 2,
  /**
   * Weakest in Ramp: in a deck of at least `fixingMinColors` colors, a ramp card that makes 2+ of them gets this many
   * extra flexibility points (Chromatic Lantern was among the weakest ramp in 5-color decks; tuning, Nov 8, 2026).
   */
  fixingPoints: 2,
  fixingMinColors: 3,
  /** Weakest in role: cards that give back their whole cost (Frantic Search untaps three lands) rank as free. */
  freeTags: ["full-refund"],
  /** Cheat targets: mana value at or above this, in a deck with at least `cheatEnablers` enablers. */
  cheatMinManaValue: 6,
  cheatEnablers: 4,
  /** Noncreature permanents count as cheat targets only with this many put-into-play (not reanimate) enablers. */
  cheatPermanentEnablers: 2,
  /** Mana strain: 2+ pips of a color whose share of land sources is under this. */
  strainPips: 2,
  strainSourceShare: 0.2,
  /** Keep scores closer than this are ties, broken by popularity (the less played card is cut first). */
  tieMargin: 0.01,
  /** At exactly 100 cards, how many weakest cards to show. */
  shortlist: 3,
  /** Archetype detection: the best archetype must score at least this, otherwise General. */
  archetypeFloor: 0.3,
  /** Archetype detection: the commander counts as this many cards for tag and type signals. */
  commanderWeight: 3,
  /** After this many "No" answers, ask whether to pick from the list. */
  archetypeRejectLimit: 3,
};

/** Flexibility points per tag, by role (sub-tags of the role not listed count 1 each). */
export const FLEX_POINTS: Record<string, Record<string, number>> = {
  removal: {
    "removal-nonland": 4,
    "removal-noncreature": 3,
    "multi-removal": 2,
    "repeatable-removal": 2,
    "removal-creature": 1,
    "removal-artifact": 1,
    "removal-enchantment": 1,
    "removal-planeswalker": 1,
    "removal-land": 1,
    "removal-battle": 1,
  },
  wipes: { "sweeper-one-sided": 3 },
};
/** Any tag starting with this is worth an extra flexibility point (engines beat one-shots). */
export const REPEATABLE_PREFIX = "repeatable";

/** Cheat enablers: cards that put big things into play without casting them. Sub-tags included. */
export const CHEAT_ENABLERS = {
  reanimate: ["reanimate"],
  /** Put-into-play effects; these also make noncreature permanents cheat targets. */
  putIntoPlay: ["sneak", "free-cast-another"],
  /**
   * Never enablers, even under the tags above: they only bring back or sneak in themselves, or lands (sneak-land is
   * land ramp; Omo counted 11 false enablers before this list grew, Nov 7, 2026).
   */
  not: ["reanimate-self", "reanimate-land", "crucible-of-worlds", "unearth", "disturb", "sneak-land", "sneak-self", "ninjutsu"],
};
