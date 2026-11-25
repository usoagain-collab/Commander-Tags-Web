// Commander on curve (v2, DefCat lesson 2, Nov 25, 2026): how often the deck can cast its commander on the turn its
// mana value says, from 1,000 seeded sample games, and how the deck's ramp lines up with the commander's cost.
// Mana only: one land a turn, ramp cast cheapest first when it fits, then the commander as soon as there's enough.
// Colors, commander tax and mulligans aren't modeled, so the numbers are a little kind.
import { shuffled } from "@/lib/playtest/game";
import { FAST_MANA } from "@/lib/brackets/speed";
import type { DeckLine } from "./model";

export type CurveCard = {
  land: boolean;
  /** Mana value to cast it (spells only). */
  mv: number;
  /** Ramp: mana it adds every later turn. 0 = not ramp. */
  tap: number;
  /** Ramp whose mana can be used the turn it's cast (rocks, rituals); dorks and land ramp wait a turn. */
  now: boolean;
  /** One-shot mana (rituals, Lotus Petal), used the turn it's cast. */
  once: number;
  quantity: number;
};

export const COMMANDER_TURN = { games: 1000, maxTurn: 10, seed: 20261125 };

export type CommanderTurn = {
  /** The commander's mana value: the turn it comes down "on curve". */
  mv: number;
  /** Share of games where it's cast by turn t (index t, 1..maxTurn; index 0 unused), on the play and on the draw. */
  play: number[];
  draw: number[];
  games: number;
};

const front = (s: string | null) => (s ?? "").split(" // ")[0];

/** A deck card as the sample games see it. `ramp` = the card fills the Ramp role. */
export function curveCard(l: DeckLine, ramp: boolean): CurveCard {
  const land = !!l.card.counts_as_land;
  const fast = FAST_MANA[l.card.name];
  const type = front(l.card.type_line);
  const tap = !ramp || land ? 0 : (fast?.tap ?? (fast?.once ? 0 : 1));
  return {
    land,
    mv: fast?.cost ?? l.card.mana_value,
    tap,
    now: /\bArtifact\b/.test(type) && !/\bCreature\b/.test(type),
    once: ramp && !land ? (fast?.once ?? 0) : 0,
    quantity: l.quantity,
  };
}

/** The first turn the commander can be cast in one shuffled game, or null when not by maxTurn. */
export function castTurn(deck: CurveCard[], commanderMv: number, onDraw: boolean, maxTurn = COMMANDER_TURN.maxTurn): number | null {
  const hand = deck.slice(0, 7);
  let next = 7;
  let lands = 0;
  let rampMana = 0;
  for (let turn = 1; turn <= maxTurn; turn++) {
    if ((turn > 1 || onDraw) && next < deck.length) hand.push(deck[next++]);
    const land = hand.findIndex((c) => c.land);
    if (land >= 0) {
      hand.splice(land, 1);
      lands++;
    }
    let mana = lands + rampMana;
    if (mana >= commanderMv) return turn;
    // Ramp, cheapest first, while it fits.
    const ramp = hand.filter((c) => c.tap > 0 || c.once > 0).sort((a, b) => a.mv - b.mv);
    let later = 0;
    for (const r of ramp) {
      if (r.mv > mana) break;
      mana -= r.mv;
      hand.splice(hand.indexOf(r), 1);
      mana += r.once + (r.now ? r.tap : 0);
      later += r.tap;
    }
    rampMana += later;
    if (mana >= commanderMv) return turn;
  }
  return null;
}

export function commanderTurn(library: CurveCard[], commanderMv: number, games = COMMANDER_TURN.games, seed = COMMANDER_TURN.seed): CommanderTurn {
  const max = COMMANDER_TURN.maxTurn;
  const cards = library.flatMap((c) => Array.from({ length: c.quantity }, () => c));
  const play = new Array(max + 1).fill(0);
  const draw = new Array(max + 1).fill(0);
  if (cards.length < 9) return { mv: commanderMv, play, draw, games: 0 };
  let s = seed;
  for (let i = 0; i < games; i++) {
    const [deck, n] = shuffled(cards, s);
    s = n;
    const p = castTurn(deck, commanderMv, false);
    const d = castTurn(deck, commanderMv, true);
    if (p !== null) for (let t = p; t <= max; t++) play[t]++;
    if (d !== null) for (let t = d; t <= max; t++) draw[t]++;
  }
  return { mv: commanderMv, play: play.map((x) => x / games), draw: draw.map((x) => x / games), games };
}

export type RampStep = {
  /** Ramp costing commander MV − 1 or − 2: cast it, then the commander a turn early. */
  onStep: DeckLine[];
  /** Ramp costing as much as the commander or more: that turn you'd rather cast the commander. */
  tooLate: DeckLine[];
  /** The step pattern that lands the commander a turn early, ending at the commander: [1, 3, 5] for a 5-drop, [2, 4, 6] for a 6-drop. */
  pattern: number[];
};

/** How the deck's ramp lines up with the commander's cost (DefCat: ramp 1 → 3 → 5 or 2 → 4 → 6). */
export function rampStep(lines: DeckLine[], isRamp: (l: DeckLine) => boolean, commanderMv: number): RampStep {
  const ramp = lines.filter((l) => l.board === "main" && isRamp(l) && !/\bLand\b/.test(front(l.card.type_line)));
  const pattern: number[] = [];
  for (let mv = commanderMv; mv >= 1; mv -= 2) pattern.unshift(mv);
  return {
    onStep: ramp.filter((l) => l.card.mana_value === commanderMv - 1 || l.card.mana_value === commanderMv - 2),
    tooLate: commanderMv >= 3 ? ramp.filter((l) => l.card.mana_value >= commanderMv) : [],
    pattern,
  };
}
