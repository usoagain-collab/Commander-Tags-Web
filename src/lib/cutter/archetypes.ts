// Starter archetypes for the Smart Cutter (data only; detection is in archetype.ts). Tag slugs were checked
// against the live tag data on Nov 7, 2026; scripts/cutter-check.mts reports any that disappear from the tree.
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
];

/** Every tag slug the starter set relies on, for the tree check in tests. */
export const archetypeSlugs = (list: Archetype[] = ARCHETYPES) =>
  [...new Set(list.flatMap((a) => a.signals.flatMap((s) => (s.kind === "tags" ? s.slugs : []))))];
