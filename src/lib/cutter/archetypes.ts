// Starter archetypes for the Smart Cutter (data only; detection is in archetype.ts). Tag slugs were checked
// against the live tag data on Nov 7, 2026 (the second batch on Nov 10, 2026); scripts/cutter-check.mts reports any that disappear from the tree.
// The curves are starting guesses to tune with real decks (docs/spec.md, Smart Cutter).

/**
 * One detection signal. Its strength rises from 0 at `from` (default 0) to 1 at `full`: with full 0.2, a signal
 * on 20% of the deck's nonland cards is at full strength. An archetype's score is the weighted average of its signals' strengths.
 * - tags: cards carrying any of these tags (sub-tags included)
 * - type: cards whose front face has this card type or subtype (Equipment, Aura, Artifact…)
 * - role: cards filling this role
 * - fact: instantsSorceries (share of spells), bigSpells (share of spells at mana value 6+),
 *   combos (two-card combos in the deck, full = that many), typal (largest creature type's share of creatures)
 */
export type Signal =
  | { kind: "tags"; slugs: string[]; weight: number; full?: number; from?: number }
  | { kind: "type"; type: string; weight: number; full?: number; from?: number }
  | { kind: "role"; role: string; weight: number; full?: number; from?: number }
  | { kind: "fact"; fact: "instantsSorceries" | "bigSpells" | "combos" | "typal"; weight: number; full?: number; from?: number };

/** Share of nonland spells (percent) at mana value 0-1, 2, 3, 4, 5, 6, 7+. Adds up to 100. */
export type Curve = [number, number, number, number, number, number, number];

export type Archetype = {
  key: string;
  name: string;
  signals: Signal[];
  curve: Curve;
  /** Per-archetype cheat thresholds (otherwise the ones in config.ts). */
  cheat?: { minManaValue?: number; enablers?: number };
  /** A power user's own profile (saved per user), not one of the starter set. */
  custom?: boolean;
};

export const DEFAULT_FULL = 0.2;
export const GENERAL_KEY = "general";

export const ARCHETYPES: Archetype[] = [
  { key: GENERAL_KEY, name: "General (midrange)", signals: [], curve: [12, 22, 24, 18, 12, 7, 5] },
  {
    key: "graveyard",
    name: "Graveyard / reanimator",
    signals: [
      { kind: "tags", slugs: ["reanimate"], weight: 3, full: 0.1 },
      { kind: "tags", slugs: ["mill-self", "graveyard-fuel"], weight: 2, full: 0.12 },
      { kind: "tags", slugs: ["discard-outlet", "loot"], weight: 1, full: 0.12 },
      { kind: "tags", slugs: ["recursion-creature"], weight: 1, full: 0.1 },
    ],
    curve: [20, 28, 24, 14, 8, 4, 2],
  },
  {
    key: "aristocrats",
    name: "Aristocrats",
    signals: [
      { kind: "tags", slugs: ["sacrifice-outlet"], weight: 3, full: 0.12 },
      { kind: "tags", slugs: ["death-trigger"], weight: 2, full: 0.15 },
      { kind: "tags", slugs: ["drain-life", "blood-artist-ability"], weight: 2, full: 0.08 },
      { kind: "tags", slugs: ["repeatable-creature-tokens"], weight: 1, full: 0.12 },
    ],
    curve: [16, 28, 26, 16, 8, 4, 2],
  },
  {
    key: "spellslinger",
    name: "Spellslinger",
    signals: [
      { kind: "fact", fact: "instantsSorceries", weight: 3, from: 0.3, full: 0.55 },
      { kind: "tags", slugs: ["cast-trigger-you", "magecraft", "prowess-like", "storm-count-matters"], weight: 2, full: 0.12 },
      { kind: "tags", slugs: ["copy-spell", "cost-reducer-instant", "cost-reducer-sorcery", "cost-reducer-instant-sorcery"], weight: 1, full: 0.08 },
    ],
    curve: [20, 30, 24, 14, 7, 3, 2],
  },
  {
    key: "voltron",
    name: "Voltron",
    signals: [
      { kind: "type", type: "Equipment", weight: 2, full: 0.12 },
      { kind: "type", type: "Aura", weight: 2, full: 0.12 },
      { kind: "tags", slugs: ["synergy-equipment", "synergy-aura", "quick-equip", "auto-equip"], weight: 2, full: 0.08 },
      { kind: "tags", slugs: ["commander-matters"], weight: 1, full: 0.04 },
    ],
    curve: [18, 30, 24, 14, 8, 4, 2],
  },
  {
    key: "tokens",
    name: "Tokens",
    signals: [
      { kind: "tags", slugs: ["repeatable-creature-tokens"], weight: 3, full: 0.2 },
      { kind: "tags", slugs: ["anthem"], weight: 2, full: 0.08 },
      { kind: "tags", slugs: ["synergy-token", "token-doubler"], weight: 2, full: 0.06 },
    ],
    curve: [12, 24, 26, 20, 10, 5, 3],
  },
  {
    key: "counters",
    name: "+1/+1 counters",
    signals: [
      { kind: "tags", slugs: ["counters-matter"], weight: 3, full: 0.2 },
      { kind: "tags", slugs: ["counter-doubler", "counter-increaser"], weight: 2, full: 0.05 },
    ],
    curve: [12, 26, 26, 18, 10, 5, 3],
  },
  {
    key: "landfall",
    name: "Landfall",
    signals: [
      { kind: "tags", slugs: ["landfall"], weight: 3, full: 0.12 },
      { kind: "tags", slugs: ["lands-matter", "land-count-matters"], weight: 2, full: 0.1 },
      { kind: "tags", slugs: ["extra-land"], weight: 1, full: 0.06 },
    ],
    curve: [14, 24, 24, 18, 10, 6, 4],
  },
  {
    key: "artifacts",
    name: "Artifacts",
    signals: [
      { kind: "type", type: "Artifact", weight: 3, from: 0.25, full: 0.5 },
      { kind: "tags", slugs: ["artifact-count-matters", "affinity-for-artifacts", "metalcraft", "improvise", "artifactfall"], weight: 2, full: 0.1 },
      { kind: "tags", slugs: ["repeatable-artifact-tokens"], weight: 1, full: 0.06 },
    ],
    curve: [22, 26, 22, 14, 8, 5, 3],
  },
  {
    key: "enchantress",
    name: "Enchantress",
    signals: [
      { kind: "type", type: "Enchantment", weight: 3, from: 0.15, full: 0.4 },
      { kind: "tags", slugs: ["enchantmentfall", "enchantment-engine", "synergy-aura"], weight: 2, full: 0.06 },
    ],
    curve: [14, 28, 26, 16, 9, 4, 3],
  },
  {
    key: "typal",
    name: "Typal",
    signals: [
      { kind: "fact", fact: "typal", weight: 3, from: 0.25, full: 0.5 },
      { kind: "tags", slugs: ["typal-creature"], weight: 2, full: 0.12 },
    ],
    curve: [12, 24, 26, 20, 10, 5, 3],
  },
  {
    key: "control",
    name: "Control / stax",
    signals: [
      { kind: "tags", slugs: ["counterspell"], weight: 2, from: 0.06, full: 0.18 },
      { kind: "tags", slugs: ["tax", "hatebear"], weight: 2, full: 0.08 },
      { kind: "role", role: "wipes", weight: 1, full: 0.08 },
      { kind: "tags", slugs: ["symmetrical"], weight: 1, full: 0.1 },
    ],
    curve: [16, 26, 24, 16, 10, 5, 3],
  },
  {
    key: "bigmana",
    name: "Big mana / ramp",
    signals: [
      { kind: "role", role: "ramp", weight: 2, full: 0.25 },
      { kind: "fact", fact: "bigSpells", weight: 3, full: 0.2 },
      { kind: "tags", slugs: ["mana-increaser", "x-cost-matters"], weight: 1, full: 0.04 },
    ],
    curve: [10, 18, 18, 16, 14, 12, 12],
  },
  {
    key: "grouphug",
    name: "Group hug",
    signals: [
      { kind: "tags", slugs: ["group-hug", "selective-group-hug"], weight: 3, full: 0.12 },
      { kind: "tags", slugs: ["donate"], weight: 1, full: 0.04 },
    ],
    curve: [10, 22, 24, 20, 12, 7, 5],
  },
  {
    key: "combo",
    name: "Combo",
    signals: [
      { kind: "fact", fact: "combos", weight: 3, from: 1, full: 5 },
      { kind: "tags", slugs: ["tutor"], weight: 2, from: 0.05, full: 0.15 },
      { kind: "tags", slugs: ["untapper", "ritual"], weight: 1, full: 0.06 },
    ],
    curve: [24, 30, 22, 12, 6, 4, 2],
  },

  // ---------- added Nov 10, 2026: common Commander archetypes, written from community vocabulary ----------
  {
    key: "blink",
    name: "Blink / flicker",
    signals: [
      { kind: "tags", slugs: ["flicker", "bounce-self"], weight: 3, full: 0.1 },
      { kind: "tags", slugs: ["enters-in-company", "trigger-doubler"], weight: 1, full: 0.08 },
    ],
    curve: [12, 24, 26, 20, 10, 5, 3],
  },
  {
    key: "lifegain",
    name: "Lifegain",
    signals: [
      { kind: "tags", slugs: ["lifegain-matters", "lifegain-increaser", "lifegain-to-damage"], weight: 3, full: 0.08 },
      { kind: "tags", slugs: ["repeatable-lifegain"], weight: 2, from: 0.08, full: 0.25 },
      { kind: "tags", slugs: ["drain-life"], weight: 1, full: 0.08 },
    ],
    curve: [14, 26, 26, 18, 9, 4, 3],
  },
  {
    key: "drain",
    name: "Drain / life loss",
    signals: [
      { kind: "tags", slugs: ["drain-life", "opponent-loses-life"], weight: 3, from: 0.06, full: 0.2 },
      { kind: "tags", slugs: ["life-loss-matters"], weight: 2, full: 0.05 },
    ],
    curve: [14, 26, 26, 18, 9, 4, 3],
  },
  {
    key: "wheels",
    name: "Wheels / draw matters",
    signals: [
      { kind: "tags", slugs: ["wheel"], weight: 3, full: 0.06 },
      { kind: "tags", slugs: ["draw-matters", "second-draw-matters", "hand-size-matters"], weight: 2, full: 0.08 },
      { kind: "tags", slugs: ["burn-player-each"], weight: 1, full: 0.06 },
    ],
    curve: [18, 28, 24, 16, 8, 4, 2],
  },
  {
    key: "discard",
    name: "Discard / madness",
    signals: [
      { kind: "tags", slugs: ["self-discard-matters", "discarded-type-matters", "opponent-discard-matters", "discard-matters"], weight: 3, full: 0.08 },
      { kind: "tags", slugs: ["discard-outlet", "discard"], weight: 2, from: 0.06, full: 0.2 },
    ],
    curve: [20, 28, 24, 14, 8, 4, 2],
  },
  {
    key: "mill",
    name: "Mill (opponents)",
    signals: [
      { kind: "tags", slugs: ["mill-opponent", "mill-each", "mill-any"], weight: 3, full: 0.15 },
      { kind: "tags", slugs: ["synergy-mill"], weight: 2, full: 0.05 },
    ],
    curve: [18, 28, 24, 16, 8, 4, 2],
  },
  {
    key: "superfriends",
    name: "Superfriends",
    signals: [
      { kind: "type", type: "Planeswalker", weight: 3, from: 0.06, full: 0.2 },
      { kind: "tags", slugs: ["synergy-planeswalker", "protects-planeswalker", "repeatable-proliferate"], weight: 2, full: 0.06 },
    ],
    curve: [10, 20, 24, 22, 14, 6, 4],
  },
  {
    key: "proliferate",
    name: "Proliferate",
    signals: [
      { kind: "tags", slugs: ["repeatable-proliferate", "pseudo-proliferate", "synergy-proliferate"], weight: 3, full: 0.08 },
      { kind: "tags", slugs: ["counter-fuel", "gives-mm-counters"], weight: 1, full: 0.1 },
    ],
    curve: [14, 26, 26, 18, 9, 4, 3],
  },
  {
    key: "infect",
    name: "Infect / poison",
    signals: [
      { kind: "tags", slugs: ["poisonous", "poison-opponents", "synergy-poison", "gives-infect", "gives-toxic", "gives-poisonous", "synergy-toxic", "synergy-infect"], weight: 3, full: 0.15 },
      { kind: "tags", slugs: ["repeatable-proliferate", "pseudo-proliferate"], weight: 1, full: 0.06 },
    ],
    curve: [18, 30, 24, 14, 8, 4, 2],
  },
  {
    key: "goad",
    name: "Goad / forced combat",
    signals: [
      { kind: "tags", slugs: ["force-attacker", "synergy-goad"], weight: 3, full: 0.1 },
      { kind: "tags", slugs: ["pillowfort", "tax-attack"], weight: 1, full: 0.05 },
    ],
    curve: [14, 26, 26, 18, 9, 4, 3],
  },
  {
    key: "pillowfort",
    name: "Pillowfort",
    signals: [
      { kind: "tags", slugs: ["pillowfort", "tax-attack", "prevent-attack"], weight: 3, from: 0.03, full: 0.12 },
      { kind: "type", type: "Enchantment", weight: 1, from: 0.1, full: 0.3 },
    ],
    curve: [14, 26, 26, 18, 9, 4, 3],
  },
  {
    key: "stax",
    name: "Stax / hatebears",
    signals: [
      { kind: "tags", slugs: ["hatebear", "tax", "cast-tax", "hate-nonbasic-land"], weight: 3, from: 0.06, full: 0.18 },
      { kind: "tags", slugs: ["mass-land-denial", "symmetrical"], weight: 1, from: 0.1, full: 0.25 },
    ],
    curve: [24, 30, 22, 12, 6, 4, 2],
  },
  {
    key: "theft",
    name: "Theft / steal",
    signals: [
      { kind: "tags", slugs: ["theft", "theft-cast", "nightveil-theft"], weight: 3, full: 0.1 },
      { kind: "tags", slugs: ["synergy-theft"], weight: 1, full: 0.03 },
    ],
    curve: [12, 22, 24, 20, 12, 6, 4],
  },
  {
    key: "clones",
    name: "Clones / copies",
    signals: [
      { kind: "tags", slugs: ["clone", "copy-permanent", "copy-permanent-spell"], weight: 3, full: 0.08 },
      { kind: "tags", slugs: ["copy-spell", "token-doubler"], weight: 1, full: 0.06 },
    ],
    curve: [12, 22, 24, 20, 12, 6, 4],
  },
  {
    key: "extraturns",
    name: "Extra turns",
    signals: [
      { kind: "tags", slugs: ["extra-turn"], weight: 3, full: 0.06 },
      { kind: "tags", slugs: ["copy-spell", "regrowth-sorcery"], weight: 1, full: 0.06 },
    ],
    curve: [16, 26, 22, 14, 10, 7, 5],
  },
  {
    key: "extracombat",
    name: "Extra combats / attack triggers",
    signals: [
      { kind: "tags", slugs: ["extra-combat-phase"], weight: 3, full: 0.04 },
      { kind: "tags", slugs: ["attack-trigger", "attacking-matters"], weight: 2, from: 0.08, full: 0.25 },
      { kind: "tags", slugs: ["gives-double-strike", "extra-untap"], weight: 1, full: 0.05 },
    ],
    curve: [14, 26, 26, 18, 9, 4, 3],
  },
  {
    key: "burn",
    name: "Burn / pingers",
    signals: [
      { kind: "tags", slugs: ["burn-player", "burn-player-each", "burn-any"], weight: 3, from: 0.06, full: 0.2 },
      { kind: "tags", slugs: ["synergy-burn", "combat-ping"], weight: 2, full: 0.04 },
    ],
    curve: [18, 28, 24, 16, 8, 4, 2],
  },
  {
    key: "treasure",
    name: "Treasure",
    signals: [
      { kind: "tags", slugs: ["repeatable-treasures"], weight: 3, full: 0.1 },
      { kind: "tags", slugs: ["synergy-treasure"], weight: 2, full: 0.04 },
    ],
    curve: [16, 26, 24, 16, 9, 5, 4],
  },
  {
    key: "food",
    name: "Food",
    signals: [
      { kind: "tags", slugs: ["repeatable-food", "synergy-food"], weight: 3, full: 0.1 },
      { kind: "tags", slugs: ["lifegain-matters"], weight: 1, full: 0.04 },
    ],
    curve: [16, 28, 26, 16, 8, 4, 2],
  },
  {
    key: "clues",
    name: "Clues / investigate",
    signals: [
      { kind: "tags", slugs: ["repeatable-clues", "synergy-clue"], weight: 3, full: 0.1 },
      { kind: "tags", slugs: ["draw-matters", "second-draw-matters"], weight: 1, full: 0.05 },
    ],
    curve: [16, 28, 26, 16, 8, 4, 2],
  },
  {
    key: "artifacttokens",
    name: "Artifact tokens",
    signals: [
      { kind: "tags", slugs: ["repeatable-artifact-tokens", "repeatable-treasures", "repeatable-clues", "repeatable-food"], weight: 3, full: 0.15 },
      { kind: "tags", slugs: ["sacrifice-outlet-artifact", "artifact-count-matters"], weight: 2, full: 0.06 },
    ],
    curve: [18, 28, 24, 16, 8, 4, 2],
  },
  {
    key: "vehicles",
    name: "Vehicles",
    signals: [
      { kind: "type", type: "Vehicle", weight: 3, full: 0.12 },
      { kind: "tags", slugs: ["synergy-vehicle", "crew"], weight: 2, full: 0.06 },
    ],
    curve: [14, 28, 26, 18, 8, 4, 2],
  },
  {
    key: "energy",
    name: "Energy",
    signals: [
      { kind: "tags", slugs: ["energy-generator", "counter-fuel-energy", "energy-increaser", "synergy-energy"], weight: 3, full: 0.15 },
    ],
    curve: [16, 28, 26, 16, 8, 4, 2],
  },
  {
    key: "flashback",
    name: "Cast from the graveyard",
    signals: [
      { kind: "tags", slugs: ["synergy-graveyard-cast", "gives-flashback", "synergy-flashback"], weight: 3, full: 0.06 },
      { kind: "tags", slugs: ["mill-self", "graveyard-fuel"], weight: 2, full: 0.12 },
      { kind: "fact", fact: "instantsSorceries", weight: 1, from: 0.2, full: 0.45 },
    ],
    curve: [20, 28, 24, 14, 8, 4, 2],
  },
  {
    key: "exilecast",
    name: "Cast from exile / top of library",
    signals: [
      { kind: "tags", slugs: ["repeatable-impulse", "synergy-exile-cast", "play-from-top", "impulse-cast"], weight: 3, full: 0.1 },
      { kind: "tags", slugs: ["impulse"], weight: 1, full: 0.1 },
    ],
    curve: [16, 28, 26, 16, 8, 4, 2],
  },
  {
    key: "lands",
    name: "Lands matter / land recursion",
    signals: [
      { kind: "tags", slugs: ["sacrifice-outlet-land", "regrowth-land", "differently-named-lands-matter", "lands-matter"], weight: 3, from: 0.06, full: 0.18 },
      { kind: "tags", slugs: ["landfall", "extra-land"], weight: 2, full: 0.1 },
    ],
    curve: [16, 26, 24, 16, 9, 5, 4],
  },
  {
    key: "bigcreatures",
    name: "Big creatures / power matters",
    signals: [
      { kind: "tags", slugs: ["power-matters", "ferocious", "power-matters-total", "greatest-power-matters", "power-doubler"], weight: 3, from: 0.08, full: 0.2 },
      { kind: "fact", fact: "bigSpells", weight: 2, from: 0.12, full: 0.25 },
    ],
    curve: [10, 18, 20, 18, 14, 11, 9],
  },
  {
    key: "toughness",
    name: "Toughness matters / defenders",
    signals: [
      { kind: "tags", slugs: ["toughness-matters", "toughness-matters-total", "synergy-defender", "buttfight", "buttcrew"], weight: 3, full: 0.08 },
      { kind: "tags", slugs: ["gives-defender", "typal-wall"], weight: 1, full: 0.04 },
    ],
    curve: [14, 28, 26, 16, 9, 4, 3],
  },
  {
    key: "keywords",
    name: "Keyword soup",
    signals: [
      { kind: "tags", slugs: ["keywords-matter", "keyword-anthem", "keyword-soup", "keyword-counter"], weight: 3, from: 0.03, full: 0.12 },
    ],
    curve: [12, 26, 26, 18, 10, 5, 3],
  },
  {
    key: "unblockable",
    name: "Evasion / combat damage triggers",
    signals: [
      { kind: "tags", slugs: ["gives-unblockable", "unblockable", "gives-evasion"], weight: 3, full: 0.1 },
      { kind: "tags", slugs: ["combat-neutral-damage-trigger"], weight: 1, full: 0.04 },
    ],
    curve: [18, 30, 24, 14, 8, 4, 2],
  },
  {
    key: "legends",
    name: "Legends / historic",
    signals: [
      { kind: "tags", slugs: ["synergy-legendary", "synergy-historic", "legendfall"], weight: 3, from: 0.04, full: 0.12 },
      { kind: "type", type: "Legendary", weight: 2, from: 0.3, full: 0.6 },
    ],
    curve: [12, 24, 26, 20, 10, 5, 3],
  },
  {
    key: "sagas",
    name: "Sagas / enchantment value",
    signals: [
      { kind: "type", type: "Saga", weight: 3, full: 0.1 },
      { kind: "tags", slugs: ["synergy-saga", "synergy-shrine"], weight: 2, full: 0.04 },
    ],
    curve: [14, 28, 26, 16, 9, 4, 3],
  },
  {
    key: "monarch",
    name: "Monarch / initiative",
    signals: [
      { kind: "tags", slugs: ["monarch-matters", "take-the-initiative", "synergy-initiative"], weight: 3, full: 0.05 },
      { kind: "tags", slugs: ["pillowfort", "tax-attack"], weight: 1, full: 0.04 },
    ],
    curve: [14, 26, 26, 18, 9, 4, 3],
  },
  {
    key: "chaos",
    name: "Chaos / coin flips and dice",
    signals: [
      { kind: "tags", slugs: ["coin-flip", "coin-flips-matter", "synergy-dice", "random-card", "conjure-random"], weight: 3, full: 0.08 },
    ],
    curve: [12, 22, 24, 20, 12, 6, 4],
  },
  {
    key: "cycling",
    name: "Cycling",
    signals: [
      { kind: "tags", slugs: ["synergy-cycling", "pseudo-cycling"], weight: 3, full: 0.06 },
      { kind: "tags", slugs: ["second-draw-matters", "draw-matters"], weight: 1, full: 0.05 },
    ],
    curve: [16, 26, 24, 16, 9, 5, 4],
  },
  {
    key: "facedown",
    name: "Face-down (morph, manifest, disguise)",
    signals: [
      { kind: "tags", slugs: ["synergy-face-down", "synergy-face-down-cast", "face-up-face-down-effects", "turn-face-down", "synergy-morph", "synergy-manifest", "synergy-disguise"], weight: 3, full: 0.06 },
    ],
    curve: [12, 24, 30, 18, 9, 4, 3],
  },
  {
    key: "daynight",
    name: "Werewolves / day and night",
    signals: [
      { kind: "tags", slugs: ["werewolf-mechanic", "day-night"], weight: 3, full: 0.12 },
    ],
    curve: [14, 28, 26, 18, 8, 4, 2],
  },
  {
    key: "party",
    name: "Party / dungeons",
    signals: [
      { kind: "tags", slugs: ["synergy-party", "affinity-for-party", "synergy-dungeon"], weight: 3, full: 0.05 },
    ],
    curve: [14, 28, 26, 16, 9, 4, 3],
  },
  {
    key: "snow",
    name: "Snow",
    signals: [
      { kind: "tags", slugs: ["synergy-snow"], weight: 3, full: 0.06 },
    ],
    curve: [14, 26, 26, 18, 9, 4, 3],
  },
  {
    key: "fight",
    name: "Fight / bite",
    signals: [
      { kind: "tags", slugs: ["one-sided-fight", "removal-fight", "synergy-fight"], weight: 3, full: 0.06 },
      { kind: "tags", slugs: ["power-matters"], weight: 1, full: 0.04 },
    ],
    curve: [12, 24, 26, 20, 10, 5, 3],
  },
  {
    key: "eldrazi",
    name: "Eldrazi / colorless",
    signals: [
      { kind: "tags", slugs: ["synergy-colorless", "synergy-colorless-mana", "eldrazi-titan"], weight: 3, full: 0.06 },
      { kind: "fact", fact: "bigSpells", weight: 2, full: 0.2 },
    ],
    curve: [10, 18, 18, 16, 14, 12, 12],
  },
  {
    key: "manasink",
    name: "Mana sinks / activated abilities",
    signals: [
      { kind: "tags", slugs: ["synergy-activated-ability", "cost-reducer-activated-ability", "gives-tap-ability"], weight: 3, full: 0.05 },
      { kind: "tags", slugs: ["untapper-creature", "untapper-permanent"], weight: 2, full: 0.06 },
      { kind: "tags", slugs: ["bottomless-mana-sink"], weight: 1, from: 0.05, full: 0.15 },
    ],
    curve: [18, 28, 24, 16, 8, 4, 2],
  },
  {
    key: "creaturecount",
    name: "Go wide / creature count",
    signals: [
      { kind: "tags", slugs: ["creature-count-matters"], weight: 3, full: 0.06 },
      { kind: "tags", slugs: ["anthem"], weight: 2, full: 0.08 },
      { kind: "type", type: "Creature", weight: 1, from: 0.4, full: 0.65 },
    ],
    curve: [14, 30, 28, 16, 7, 3, 2],
  },
  {
    key: "lifepayment",
    name: "Pay life",
    signals: [
      // Staples pay life (Toxic Deluge, Snuff Out, phyrexian mana), so paying alone needs a big share.
      { kind: "tags", slugs: ["self-life-loss-matters", "synergy-life-payment"], weight: 3, full: 0.05 },
      { kind: "tags", slugs: ["life-payment"], weight: 2, from: 0.12, full: 0.3 },
    ],
    curve: [18, 28, 24, 16, 8, 4, 2],
  },
];

/** Every tag slug the starter set relies on, for the tree check in tests. */
export const archetypeSlugs = (list: Archetype[] = ARCHETYPES) =>
  [...new Set(list.flatMap((a) => a.signals.flatMap((s) => (s.kind === "tags" ? s.slugs : []))))];
