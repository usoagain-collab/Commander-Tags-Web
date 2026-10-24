import { describe, expect, it } from "vitest";
import {
  createToken,
  addCounter,
  mill,
  resolveScry,
  topCards,
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

describe("counters and library tools (6b)", () => {
  const started = () => keep(newGame(deck, 11));

  it("adds and removes counters; a kind at 0 disappears; they go when the card leaves", () => {
    let g = started();
    const card = g.zones.hand[0];
    g = move(g, card, "battlefield");
    g = addCounter(addCounter(g, card, "+1/+1", 2), card, "charge", 1);
    expect(g.battlefield[card].counters).toEqual({ "+1/+1": 2, charge: 1 });
    g = addCounter(g, card, "charge", -1);
    expect(g.battlefield[card].counters).toEqual({ "+1/+1": 2 });
    expect(addCounter(g, card, "+1/+1", -5).battlefield[card].counters).toEqual({});
    g = move(move(g, card, "hand"), card, "battlefield");
    expect(g.battlefield[card].counters).toBeUndefined();
    expect(addCounter(g, g.zones.hand[0], "+1/+1", 1)).toBe(g); // not on the battlefield
  });

  it("mills the top N into the graveyard", () => {
    const g = started();
    const top3 = g.zones.library.slice(0, 3);
    const m = mill(g, 3);
    expect(m.zones.graveyard).toEqual(top3);
    expect(m.zones.library).toHaveLength(g.zones.library.length - 3);
    expect(mill(g, 0)).toBe(g);
  });

  it("scry: chosen order on top, bottoms at the bottom; surveil sends to the graveyard", () => {
    const g = started();
    const [a, b, c] = topCards(g, 3);
    const s = resolveScry(g, [c, a, b], { a: "top", [a]: "top", [b]: "bottom", [c]: "top" });
    expect(s.zones.library.slice(0, 2)).toEqual([c, a]);
    expect(s.zones.library.at(-1)).toBe(b);
    expect(s.zones.library).toHaveLength(g.zones.library.length);
    const v = resolveScry(g, [a, b], { [a]: "graveyard", [b]: "top" });
    expect(v.zones.graveyard).toEqual([a]);
    expect(v.zones.library[0]).toBe(b);
  });
});

describe("tokens (6c)", () => {
  it("creates tokens on the battlefield; a token leaving the battlefield stops existing", () => {
    let g = keep(newGame(deck, 21));
    g = createToken(createToken(g, { name: "Treasure", image: null, typeLine: "Token Artifact — Treasure" }), { name: "Treasure", image: null, typeLine: "Token Artifact — Treasure" });
    const [t1, t2] = g.zones.battlefield;
    expect([t1, t2]).toEqual(["t1", "t2"]);
    expect(g.cards[t1].token).toBe(true);
    g = toggleTap(g, t1);
    expect(g.battlefield[t1].tapped).toBe(true);
    g = move(g, t1, "graveyard");
    expect(g.cards[t1]).toBeUndefined();
    expect(g.zones.graveyard).not.toContain(t1);
    expect(g.zones.battlefield).toEqual([t2]);
    expect(Object.values(g.zones).reduce((n, z) => n + z.length, 0)).toBe(101); // 100 cards + 1 token
  });
});
