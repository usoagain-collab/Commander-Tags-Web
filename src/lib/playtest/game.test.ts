import { describe, expect, it } from "vitest";
import {
  bottomCount,
  commanderTax,
  deckKey,
  draw,
  keep,
  move,
  mulligan,
  newGame,
  nextTurn,
  putOnBottom,
  readSaved,
  shuffled,
  toggleTap,
  untapAll,
  zoneOf,
  type DeckCard,
} from "./game";

const deck: DeckCard[] = [
  { oracleId: "omo", name: "Omo", image: null, typeLine: "Legendary Creature — Spirit", quantity: 1, commander: true },
  { oracleId: "forest", name: "Forest", image: null, typeLine: "Basic Land — Forest", quantity: 40, commander: false },
  { oracleId: "elf", name: "Llanowar Elves", image: null, typeLine: "Creature — Elf Druid", quantity: 1, commander: false },
  ...Array.from({ length: 58 }, (_, i) => ({
    oracleId: `spell${i}`,
    name: `Spell ${i}`,
    image: null,
    typeLine: "Sorcery",
    quantity: 1,
    commander: false,
  })),
];
const count = (g: ReturnType<typeof newGame>) => Object.values(g.zones).reduce((n, z) => n + z.length, 0);

describe("shuffled", () => {
  it("is repeatable with the same seed and keeps every card", () => {
    const [a] = shuffled([1, 2, 3, 4, 5, 6], 42);
    const [b] = shuffled([1, 2, 3, 4, 5, 6], 42);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("starting a game", () => {
  it("puts the commander in the command zone, draws 7 and keeps 100 cards", () => {
    const g = newGame(deck, 1);
    expect(g.zones.command).toHaveLength(1);
    expect(g.cards[g.zones.command[0]].name).toBe("Omo");
    expect(g.zones.hand).toHaveLength(7);
    expect(g.zones.library).toHaveLength(92);
    expect(count(g)).toBe(100);
    expect(g.stage).toBe("mulligan");
  });

  it("London mulligan: new 7 each time; the first mulligan is free, then one card per mulligan to the bottom", () => {
    let g = mulligan(newGame(deck, 7));
    expect(g.zones.hand).toHaveLength(7);
    expect(keep(g).stage).toBe("playing"); // first one free
    g = mulligan(g);
    g = keep(g);
    expect(g.stage).toBe("bottom");
    expect(g.toBottom).toBe(1);
    const bottomed = g.zones.hand[0];
    g = putOnBottom(g, bottomed);
    expect(g.stage).toBe("playing");
    expect(g.zones.hand).toHaveLength(6);
    expect(g.zones.library.at(-1)).toBe(bottomed);
    expect(count(g)).toBe(100);
  });

  it("without the free mulligan, the first one costs a card", () => {
    expect(bottomCount(1, false)).toBe(1);
    expect(bottomCount(1, true)).toBe(0);
    expect(keep(mulligan(newGame(deck, 3, false))).toBottom).toBe(1);
  });
});

describe("playing", () => {
  const started = () => keep(newGame(deck, 5));

  it("draws, plays, taps, untaps and moves on to the next turn", () => {
    let g = started();
    const card = g.zones.hand[0];
    g = move(g, card, "battlefield", { at: { x: 20, y: 30 } });
    expect(zoneOf(g, card)).toBe("battlefield");
    expect(g.battlefield[card]).toEqual({ x: 20, y: 30, tapped: false });
    g = toggleTap(g, card);
    expect(g.battlefield[card].tapped).toBe(true);
    g = nextTurn(g);
    expect(g.turn).toBe(2);
    expect(g.battlefield[card].tapped).toBe(false);
    expect(g.zones.hand).toHaveLength(7); // 6 left + 1 drawn
    expect(untapAll(g)).toEqual(g);
  });

  it("leaving the battlefield forgets position and tapped state; library top or bottom", () => {
    let g = started();
    const card = g.zones.hand[0];
    g = toggleTap(move(g, card, "battlefield"), card);
    g = move(g, card, "library", { library: "bottom" });
    expect(g.battlefield[card]).toBeUndefined();
    expect(g.zones.library.at(-1)).toBe(card);
    g = move(g, card, "library");
    expect(g.zones.library[0]).toBe(card);
    expect(draw(g).zones.hand.at(-1)).toBe(card);
  });

  it("casting the commander from the command zone adds 2 tax each time", () => {
    let g = started();
    const omo = g.zones.command[0];
    expect(commanderTax(g, omo)).toBe(0);
    g = move(g, omo, "battlefield");
    expect(commanderTax(g, omo)).toBe(2);
    g = move(move(g, omo, "command"), omo, "battlefield");
    expect(commanderTax(g, omo)).toBe(4);
    expect(move(g, omo, "graveyard").casts).toEqual(g.casts); // dying doesn't change tax
  });
});

describe("saving", () => {
  it("reuses a saved game only for the same deck list", () => {
    const g = newGame(deck, 9);
    const raw = JSON.stringify({ deckKey: deckKey(deck), state: g });
    expect(readSaved(raw, deckKey(deck))).toEqual(g);
    expect(readSaved(raw, deckKey(deck.slice(1)))).toBeNull();
    expect(readSaved("not json", deckKey(deck))).toBeNull();
  });
});
