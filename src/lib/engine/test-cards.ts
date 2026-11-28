// Printed cards for engine tests and benchmarks: basic lands, vanilla creatures, a do-nothing instant and
// sorcery, and one card of each multi-face layout PR 1 handles. Oracle ids here are made up.

import { face } from "./cards";
import type { CardDef, FaceDef, Layout } from "./types";

const card = (oracleId: string, layout: Layout, ...faces: FaceDef[]): CardDef => ({ oracleId, layout, faces, script: null });
const basic = (name: string, sub: string) => card(`test-${name.toLowerCase()}`, "normal", face({ name, typeLine: `Basic Land — ${sub}` }));

export const PLAINS = basic("Plains", "Plains");
export const ISLAND = basic("Island", "Island");
export const SWAMP = basic("Swamp", "Swamp");
export const MOUNTAIN = basic("Mountain", "Mountain");
export const FOREST = basic("Forest", "Forest");
export const TUNDRA = card("test-tundra", "normal", face({ name: "Tundra", typeLine: "Land — Plains Island" }));

export const BEARS = card("test-bears", "normal", face({ name: "Grizzly Bears", typeLine: "Creature — Bear", manaCost: "{1}{G}", power: "2", toughness: "2" }));
export const SAVANNAH_LIONS = card("test-lions", "normal", face({ name: "Savannah Lions", typeLine: "Creature — Cat", manaCost: "{W}", power: "2", toughness: "1" }));
export const HILL_GIANT = card("test-giant", "normal", face({ name: "Hill Giant", typeLine: "Creature — Giant", manaCost: "{3}{R}", power: "3", toughness: "3" }));
export const ORNITHOPTER = card("test-ornithopter", "normal", face({ name: "Ornithopter", typeLine: "Artifact Creature — Thopter", manaCost: "{0}", power: "0", toughness: "2" }));
export const WALL_OF_NOTHING = card("test-zero-toughness", "normal", face({ name: "Shade of Nothing", typeLine: "Creature — Shade", manaCost: "{B}", power: "1", toughness: "0" }));
export const COLOSSUS = card("test-colossus", "normal", face({ name: "Big Colossus", typeLine: "Artifact Creature — Golem", manaCost: "{7}", power: "7", toughness: "7" }));
export const WASTES_GOLEM = card("test-colorless", "normal", face({ name: "Eldrazi Drone", typeLine: "Creature — Eldrazi", manaCost: "{C}", power: "1", toughness: "1" }));

export const QUICK_SPELL = card("test-instant", "normal", face({ name: "Quick Thought", typeLine: "Instant", manaCost: "{U}" }));
export const SLOW_SPELL = card("test-sorcery", "normal", face({ name: "Slow Thought", typeLine: "Sorcery", manaCost: "{1}{B}" }));
export const X_SPELL = card("test-x", "normal", face({ name: "Fireball-ish", typeLine: "Sorcery", manaCost: "{X}{R}" }));
export const PLANESWALKER = card("test-walker", "normal", face({ name: "Test Walker", typeLine: "Legendary Planeswalker — Tester", manaCost: "{2}{W}", loyalty: "3" }));

export const MDFC = card(
  "test-mdfc",
  "modal_dfc",
  face({ name: "Spell Side", typeLine: "Sorcery", manaCost: "{2}{G}" }),
  face({ name: "Land Side", typeLine: "Land — Forest" }),
);
export const TRANSFORMER = card(
  "test-transform",
  "transform",
  face({ name: "Day Wolf", typeLine: "Creature — Wolf", manaCost: "{1}{G}", power: "2", toughness: "2" }),
  face({ name: "Night Wolf", typeLine: "Creature — Werewolf", power: "4", toughness: "4", colors: ["G"] }),
);
export const ADVENTURER = card(
  "test-adventure",
  "adventure",
  face({ name: "Brave Knight", typeLine: "Creature — Human Knight", manaCost: "{1}{W}", power: "2", toughness: "2" }),
  face({ name: "Quick Quest", typeLine: "Instant — Adventure", manaCost: "{W}" }),
);
export const SPLIT = card(
  "test-split",
  "split",
  face({ name: "Fire", typeLine: "Instant", manaCost: "{1}{R}" }),
  face({ name: "Ice", typeLine: "Instant", manaCost: "{1}{U}" }),
);

export const ROOM = card(
  "test-room",
  "room",
  face({ name: "Front Door", typeLine: "Enchantment — Room", manaCost: "{1}{W}" }),
  face({ name: "Back Door", typeLine: "Enchantment — Room", manaCost: "{2}{B}" }),
);

/** n copies of each card, in order. */
export function deckOf(...entries: [CardDef, number][]): CardDef[] {
  return entries.flatMap(([c, n]) => Array<CardDef>(n).fill(c));
}

/** A mixed deck that touches every PR 1 path. */
export function mixedDeck(size: number): CardDef[] {
  const pool: CardDef[] = [
    PLAINS, ISLAND, SWAMP, MOUNTAIN, FOREST, TUNDRA, FOREST, ISLAND, PLAINS, MOUNTAIN,
    BEARS, SAVANNAH_LIONS, HILL_GIANT, ORNITHOPTER, WALL_OF_NOTHING, COLOSSUS, WASTES_GOLEM,
    QUICK_SPELL, SLOW_SPELL, X_SPELL, PLANESWALKER, MDFC, TRANSFORMER, ADVENTURER, SPLIT, ROOM,
  ];
  return Array.from({ length: size }, (_, i) => pool[i % pool.length]);
}
