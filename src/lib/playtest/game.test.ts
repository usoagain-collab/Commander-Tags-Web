import { describe, expect, it } from "vitest";
import {
  createToken,
  backImageOf,
  faceImage,
  faceName,
  flipCard,
  inLandRow,
  toggleFaceDown,
  addCounter,
  mill,
  resolveScry,
  topCards,
  bottomCount,
  commanderTax,
  pilesOf,
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
import { viewOf } from "./room";

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

describe("pilesOf", () => {
  const withForests = () => {
    let g = keep(newGame(deck, 1));
    const forests = [...g.zones.library, ...g.zones.hand].filter((iid) => g.cards[iid].name === "Forest").slice(0, 3);
    for (const iid of forests) g = move(g, iid, "battlefield");
    return { g, forests };
  };

  it("stacks untapped cards by name and splits off tapped ones, untapped first", () => {
    const { g, forests } = withForests();
    expect(pilesOf(g, forests).map((p) => [p.tapped, p.ids.length])).toEqual([[false, 3]]);
    const tapped = toggleTap(g, forests[0]);
    expect(pilesOf(tapped, forests).map((p) => [p.tapped, p.ids.length])).toEqual([
      [false, 2],
      [true, 1],
    ]);
  });

  it("keeps a card with counters apart", () => {
    const { g, forests } = withForests();
    expect(pilesOf(addCounter(g, forests[0], "charge", 1), forests).map((p) => p.ids.length).sort()).toEqual([1, 2]);
  });
});

describe("flipping and face-down cards", () => {
  const mdfc: DeckCard = { oracleId: "sink", name: "Sink into Stupor // Soporific Springs", image: "https://cards.scryfall.io/normal/front/a/b/ab.jpg", back: "https://cards.scryfall.io/normal/back/a/b/ab.jpg", typeLine: "Instant // Land", quantity: 1, commander: false };
  const start = () => {
    const g = keep(newGame([...deck, mdfc], 3));
    const iid = Object.values(g.cards).find((c) => c.oracleId === "sink")!.iid;
    const elf = Object.values(g.cards).find((c) => c.oracleId === "elf")!.iid;
    return { g, iid, elf };
  };

  it("finds the back image only for layouts that have one", () => {
    expect(backImageOf(mdfc.image, "modal_dfc")).toBe(mdfc.back);
    expect(backImageOf(mdfc.image, "split")).toBeNull();
    expect(backImageOf(null, "transform")).toBeNull();
  });

  it("flips a card with a back face; a flipped MDFC played from hand counts as its land side", () => {
    const { g, iid, elf } = start();
    expect(flipCard(g, elf)).toBe(g);
    let v = flipCard(g, iid);
    expect(faceImage(v.cards[iid])).toBe(mdfc.back);
    expect(faceName(v.cards[iid])).toBe("Soporific Springs");
    v = move(v, iid, "battlefield");
    expect(v.cards[iid].flipped).toBe(true);
    expect(inLandRow(v.cards[iid])).toBe(true);
    // Leaving the battlefield turns it front up again.
    v = move(v, iid, "graveyard");
    expect(v.cards[iid].flipped).toBe(false);
    expect(faceImage(v.cards[iid])).toBe(mdfc.image);
  });

  it("turns any card face down until it changes zones", () => {
    const { g, elf } = start();
    let v = toggleFaceDown(move(g, elf, "battlefield"), elf);
    expect(v.cards[elf].faceDown).toBe(true);
    expect(v.zones.battlefield).toContain(elf);
    expect(toggleFaceDown(v, elf).cards[elf].faceDown).toBe(false);
    v = move(v, elf, "exile");
    expect(v.cards[elf].faceDown).toBe(false);
  });

  it("a card turned face down in hand stays down when played or exiled (morph, foretell), not when moved elsewhere", () => {
    const { g, elf } = start();
    const inHand = move(g, elf, "hand");
    const down = toggleFaceDown(inHand, elf);
    expect(move(down, elf, "battlefield").cards[elf].faceDown).toBe(true);
    expect(move(down, elf, "exile").cards[elf].faceDown).toBe(true);
    expect(move(down, elf, "graveyard").cards[elf].faceDown).toBe(false);
  });

  it("a face-down land is a creature, not a land; tokens go in the play area", () => {
    const { g } = start();
    const forest = [...g.zones.library, ...g.zones.hand].find((i) => g.cards[i].name === "Forest")!;
    const v = toggleFaceDown(move(g, forest, "battlefield"), forest);
    expect(inLandRow(v.cards[forest])).toBe(false);
    const t = createToken(v, { name: "Treasure", image: null, typeLine: "Token Artifact — Treasure" });
    expect(t.battlefield.t1).not.toEqual(t.battlefield[forest]);
  });

  it("other players see a face-down card as a back", () => {
    const { g, elf } = start();
    const v = viewOf(toggleFaceDown(move(g, elf, "battlefield"), elf), { id: "me", name: "Me", deck: "D" }, {});
    expect(v.battlefield.find((c) => c.iid === elf)).toMatchObject({ name: "Face-down card", image: null });
  });
});
