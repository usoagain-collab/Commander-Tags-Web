// Commander Brackets rules, as DATA (spec: "Rules as config"). When WotC updates the brackets, edit this file;
// the evaluator (evaluate.ts) reads everything from here.
//
// Source: WotC Commander Brackets beta (Feb 11, 2025), the October 21, 2025 update (tutor limits removed entirely,
// "no early-game combos" replaced by how many turns a game is expected to last) and the February 9, 2026 update
// (Farewell and Biorhythm became Game Changers). Rechecked Nov 11, 2026 against magic.wizards.com.
// Choices made with David (Oct 19 and 21, 2026):
//   - "a few" extra-turn cards in brackets 2-3 = up to 2;
//   - two-card combos follow Commander Spellbook's own rating of each combo (see comboBracketByTag);
//   - combos that also need a generic piece ("any sacrifice outlet") don't count as two-card combos.

export type BracketNumber = 1 | 2 | 3 | 4 | 5;

export const BRACKETS: { n: BracketNumber; name: string; blurb: string; turns: string }[] = [
  { n: 1, name: "Exhibition", blurb: "Theme first; no Game Changers, two-card combos, extra turns or mass land denial.", turns: "Games are expected to last at least 9 turns." },
  { n: 2, name: "Core", blurb: "Precon level; no Game Changers, two-card combos or mass land denial; extra turns only a few, never chained.", turns: "Games are expected to last at least 8 turns." },
  { n: 3, name: "Upgraded", blurb: "Up to 3 Game Changers; no mass land denial; no two-card combos that win early; extra turns only a few, never chained.", turns: "Nobody expects to win or lose before turn 6." },
  { n: 4, name: "Optimized", blurb: "Anything legal goes: strong, fast decks, short of a competitive (cEDH) build.", turns: "Games can end from turn 4." },
  { n: 5, name: "cEDH", blurb: "Competitive: built to win as fast as possible, with the metagame in mind.", turns: "Games can end on any turn." },
];

export const BRACKET_RULES = {
  /** Most Game Changers allowed in each bracket. */
  gameChangersMax: { 1: 0, 2: 0, 3: 3, 4: Infinity, 5: Infinity } as Record<BracketNumber, number>,
  /** Lowest bracket that allows mass land denial. */
  massLandDenialFrom: 4 as BracketNumber,
  /** Most extra-turn cards allowed ("a few, not chained" in 2-3 = up to 2). */
  extraTurnsMax: { 1: 0, 2: 2, 3: 2, 4: Infinity, 5: Infinity } as Record<BracketNumber, number>,
  /**
   * The lowest bracket a two-card combo fits in, from Commander Spellbook's rating letter (their own
   * conversion): Ruthless 4, Spicy 3, Powerful 3, Oddball 2, Core 2, Exhibition 1 (fine anywhere).
   */
  comboBracketByTag: { R: 4, S: 3, P: 3, O: 2, C: 2, E: 1 } as Record<string, BracketNumber>,
  /** A combo Spellbook hasn't rated. */
  comboBracketUntagged: 3 as BracketNumber,
  /** Count combos that also need a generic piece ("any sacrifice outlet") as two-card combos? */
  comboCountsWithRequirements: false,
  /**
   * Default Tutors role target per bracket (David, Nov 7, 2026): fewer tutors in low brackets, more in high ones.
   * Deck Genome's suggestion, not a WotC rule (the October 2025 update removed tutor limits), so it never moves the
   * bracket estimate. A deck follows these until its Tutors slider is moved.
   */
  tutorTargets: { 1: 0, 2: 1, 3: 3, 4: 6, 5: 10 } as Record<BracketNumber, number>,
  /** Oracle tags (with their sub-tags) that mark the card kinds the brackets limit. */
  tags: { massLandDenial: ["mass-land-denial"], extraTurn: ["extra-turn"] },
};

export const COMBO_TAG_NAMES: Record<string, string> = {
  R: "Ruthless",
  S: "Spicy",
  P: "Powerful",
  O: "Oddball",
  C: "Core",
  E: "Exhibition",
};
