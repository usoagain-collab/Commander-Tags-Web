// Playtester game logic (Phase 6a): a solo goldfish game as plain data, so it's easy to test, to save in session
// storage (David: keep the game across a refresh), and to undo later if wanted. Every function returns a new
// state; nothing is mutated.

export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "exile" | "command";
export const ZONES: Zone[] = ["library", "hand", "battlefield", "graveyard", "exile", "command"];

/** One physical card (a deck with 30 Forests has 30 instances). */
export type Instance = {
  iid: string;
  oracleId: string;
  name: string;
  image: string | null;
  typeLine: string;
  /** Front face is a land: it sits in the lands row on the battlefield. */
  land: boolean;
  commander: boolean;
  /** A token (6c): it sits in the tokens row and stops existing when it leaves the battlefield. */
  token?: boolean;
};

/** Where a nonland card sits on the battlefield (percent of the play area), and whether it's tapped. */
export type Placed = {
  x: number;
  y: number;
  tapped: boolean;
  /** Counters by kind ("+1/+1", "loyalty", "charge", or any name). Gone when the card leaves the battlefield. */
  counters?: Record<string, number>;
};

export type GameState = {
  version: 1;
  cards: Record<string, Instance>;
  /** Card ids in each zone, in order. Library index 0 is the TOP card; hand and graveyard are oldest first. */
  zones: Record<Zone, string[]>;
  battlefield: Record<string, Placed>;
  life: number;
  turn: number;
  /** Times each commander was cast from the command zone (tax = 2 × this). */
  casts: Record<string, number>;
  /** Mulligan flow: "mulligan" while choosing, "bottom" while putting cards on the bottom, then "playing". */
  stage: "mulligan" | "bottom" | "playing";
  mulligans: number;
  /** Cards still to put on the bottom after keeping. */
  toBottom: number;
  freeMulligan: boolean;
  /** Counter for token ids (t1, t2, …). */
  tokensMade?: number;
  /** The library's top card is shown face up (Courser of Kruphix, Future Sight…), until turned back down. */
  topRevealed?: boolean;
  seed: number;
};

export type DeckCard = { oracleId: string; name: string; image: string | null; typeLine: string; quantity: number; commander: boolean };

// ---------- randomness (seeded, so tests and replays are repeatable) ----------

/** mulberry32: small, fast, good enough for shuffling cards. Returns [value 0..1, next seed]. */
function rand(seed: number): [number, number] {
  let t = (seed + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Fisher-Yates shuffle with the game's seed. */
export function shuffled<T>(items: T[], seed: number): [T[], number] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    const [r, n] = rand(s);
    s = n;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}

const frontIsLand = (typeLine: string) => /\bLand\b/.test(typeLine.split(" // ")[0]);

// ---------- starting a game ----------

/** Shuffles the deck, puts the commander(s) in the command zone and draws 7. */
export function newGame(deck: DeckCard[], seed: number, freeMulligan = true): GameState {
  const cards: Record<string, Instance> = {};
  const library: string[] = [];
  const command: string[] = [];
  let n = 0;
  for (const c of deck) {
    for (let k = 0; k < c.quantity; k++) {
      const iid = `c${++n}`;
      cards[iid] = { iid, oracleId: c.oracleId, name: c.name, image: c.image, typeLine: c.typeLine, land: frontIsLand(c.typeLine), commander: c.commander };
      (c.commander ? command : library).push(iid);
    }
  }
  const [lib, s] = shuffled(library, seed);
  const state: GameState = {
    version: 1,
    cards,
    zones: { library: lib, hand: [], battlefield: [], graveyard: [], exile: [], command },
    battlefield: {},
    life: 40,
    turn: 1,
    casts: {},
    stage: "mulligan",
    mulligans: 0,
    toBottom: 0,
    freeMulligan,
    seed: s,
  };
  return draw(state, 7);
}

/** London mulligan: shuffle the hand back and draw a new 7. */
export function mulligan(state: GameState): GameState {
  if (state.stage !== "mulligan") return state;
  const [lib, s] = shuffled([...state.zones.library, ...state.zones.hand], state.seed);
  return draw({ ...state, zones: { ...state.zones, library: lib, hand: [] }, seed: s, mulligans: state.mulligans + 1 }, 7);
}

/** How many cards a kept hand puts on the bottom (the first mulligan is free in multiplayer, rule 103.5c). */
export const bottomCount = (mulligans: number, freeMulligan: boolean) => Math.max(0, mulligans - (freeMulligan ? 1 : 0));

/** Keep the hand; if mulligans cost cards, choose that many to put on the bottom next. */
export function keep(state: GameState): GameState {
  if (state.stage !== "mulligan") return state;
  const n = Math.min(bottomCount(state.mulligans, state.freeMulligan), state.zones.hand.length);
  return { ...state, stage: n > 0 ? "bottom" : "playing", toBottom: n };
}

/** While choosing bottoms: put this hand card on the bottom of the library. */
export function putOnBottom(state: GameState, iid: string): GameState {
  if (state.stage !== "bottom" || !state.zones.hand.includes(iid)) return state;
  const left = state.toBottom - 1;
  return {
    ...state,
    zones: { ...state.zones, hand: state.zones.hand.filter((x) => x !== iid), library: [...state.zones.library, iid] },
    toBottom: left,
    stage: left > 0 ? "bottom" : "playing",
  };
}

// ---------- turn actions ----------

export function draw(state: GameState, count = 1): GameState {
  const n = Math.min(count, state.zones.library.length);
  if (n <= 0) return state;
  return {
    ...state,
    zones: { ...state.zones, library: state.zones.library.slice(n), hand: [...state.zones.hand, ...state.zones.library.slice(0, n)] },
  };
}

/** A revealed top card stays revealed after a shuffle: the new top card shows, as with Courser of Kruphix. */
export function shuffleLibrary(state: GameState): GameState {
  const [lib, s] = shuffled(state.zones.library, state.seed);
  return { ...state, zones: { ...state.zones, library: lib }, seed: s };
}

export function toggleTap(state: GameState, iid: string): GameState {
  const p = state.battlefield[iid];
  if (!p) return state;
  return { ...state, battlefield: { ...state.battlefield, [iid]: { ...p, tapped: !p.tapped } } };
}

export function untapAll(state: GameState): GameState {
  const battlefield: Record<string, Placed> = {};
  for (const [iid, p] of Object.entries(state.battlefield)) battlefield[iid] = p.tapped ? { ...p, tapped: false } : p;
  return { ...state, battlefield };
}

/** Next turn: untap everything, then draw a card. */
export function nextTurn(state: GameState): GameState {
  return draw(untapAll({ ...state, turn: state.turn + 1 }));
}

export const setLife = (state: GameState, life: number): GameState => ({ ...state, life });

// ---------- moving cards ----------

/** Where a card is now. */
export function zoneOf(state: GameState, iid: string): Zone | null {
  return ZONES.find((z) => state.zones[z].includes(iid)) ?? null;
}

export type MoveOptions = {
  /** Battlefield position (percent of the play area) for nonland cards. */
  at?: { x: number; y: number };
  /** Library: "top" (default) or "bottom". */
  library?: "top" | "bottom";
};

/**
 * Moves a card to a zone. Leaving the battlefield forgets its position and tapped state. A commander moving from
 * the command zone to the battlefield counts as a cast (commander tax goes up by 2).
 */
export function move(state: GameState, iid: string, to: Zone, opts: MoveOptions = {}): GameState {
  const from = zoneOf(state, iid);
  if (!from) return state;
  // A token that leaves the battlefield ceases to exist (rule 111.7).
  if (state.cards[iid].token && from === "battlefield" && to !== "battlefield") return removeCard(state, iid);
  if (from === to) {
    // Within the library: move to the top or bottom (scry, "put on top"). Within the battlefield: reposition.
    if (to === "library") {
      const rest = state.zones.library.filter((x) => x !== iid);
      return { ...state, zones: { ...state.zones, library: opts.library === "bottom" ? [...rest, iid] : [iid, ...rest] } };
    }
    if (to !== "battlefield" || !opts.at) return state;
    return { ...state, battlefield: { ...state.battlefield, [iid]: { ...state.battlefield[iid], ...clampPos(opts.at) } } };
  }
  const zones = { ...state.zones, [from]: state.zones[from].filter((x) => x !== iid) };
  if (to === "library") zones.library = opts.library === "bottom" ? [...zones.library, iid] : [iid, ...zones.library];
  else zones[to] = [...zones[to], iid];

  const battlefield = { ...state.battlefield };
  if (from === "battlefield") delete battlefield[iid];
  if (to === "battlefield") battlefield[iid] = { ...clampPos(opts.at ?? nextSpot(state)), tapped: false };

  const casts = from === "command" && to === "battlefield" && state.cards[iid].commander ? { ...state.casts, [iid]: (state.casts[iid] ?? 0) + 1 } : state.casts;
  return { ...state, zones, battlefield, casts };
}

const clampPos = (p: { x: number; y: number }) => ({ x: Math.min(92, Math.max(0, p.x)), y: Math.min(85, Math.max(0, p.y)) });

/** A free-ish spot for a card played without a drop position (keyboard or button), left to right. */
function nextSpot(state: GameState) {
  const n = state.zones.battlefield.filter((iid) => !state.cards[iid].land).length;
  return { x: (n % 10) * 9 + 1, y: Math.floor(n / 10) * 30 + 2 };
}

export const commanderTax = (state: GameState, iid: string) => 2 * (state.casts[iid] ?? 0);

// ---------- saving ----------

/** A saved game, if it's for the same deck list (cards changed in the editor = start fresh). */
export function readSaved(raw: string | null, deckKey: string): GameState | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as { deckKey?: string; state?: GameState };
    return saved.deckKey === deckKey && saved.state?.version === 1 ? saved.state : null;
  } catch {
    return null;
  }
}

/** Identifies a deck list (which cards, how many), so a saved game is only reused for the same list. */
export const deckKey = (deck: DeckCard[]) =>
  deck
    .map((c) => `${c.commander ? "C" : ""}${c.quantity}x${c.oracleId}`)
    .sort()
    .join(",");

// ---------- counters (6b) ----------

export const COUNTER_KINDS = ["+1/+1", "-1/-1", "loyalty", "charge"] as const;

/** Adds (or with a negative delta removes) counters on a battlefield card. A kind at 0 disappears. */
export function addCounter(state: GameState, iid: string, kind: string, delta: number): GameState {
  const p = state.battlefield[iid];
  const k = kind.trim();
  if (!p || !k || !delta) return state;
  const counters = { ...(p.counters ?? {}) };
  const n = Math.max(0, (counters[k] ?? 0) + delta);
  if (n) counters[k] = n;
  else delete counters[k];
  return { ...state, battlefield: { ...state.battlefield, [iid]: { ...p, counters } } };
}

// ---------- library tools (6b) ----------

/** Puts the top N cards of the library into the graveyard (top card first). */
export function mill(state: GameState, count: number): GameState {
  const n = Math.max(0, Math.min(count, state.zones.library.length));
  if (!n) return state;
  const milled = state.zones.library.slice(0, n);
  return { ...state, zones: { ...state.zones, library: state.zones.library.slice(n), graveyard: [...state.zones.graveyard, ...milled] } };
}

/** The top N cards (for scry / surveil). */
export const topCards = (state: GameState, count: number) => state.zones.library.slice(0, Math.max(0, count));

export type ScryChoice = "top" | "bottom" | "graveyard";

/**
 * Finishes a scry or surveil: `order` is the looked-at cards in the order to put back on top (first = new top
 * card); each card's choice sends it to the top, the bottom (in the order given), or the graveyard (surveil).
 * Cards not looked at stay where they were.
 */
export function resolveScry(state: GameState, order: string[], choice: Record<string, ScryChoice>): GameState {
  const looked = new Set(order);
  const rest = state.zones.library.filter((iid) => !looked.has(iid));
  const top = order.filter((iid) => (choice[iid] ?? "top") === "top");
  const bottom = order.filter((iid) => choice[iid] === "bottom");
  const toGrave = order.filter((iid) => choice[iid] === "graveyard");
  return {
    ...state,
    zones: { ...state.zones, library: [...top, ...rest, ...bottom], graveyard: [...state.zones.graveyard, ...toGrave] },
  };
}

export const setTopRevealed = (state: GameState, on: boolean): GameState => ({ ...state, topRevealed: on });

// ---------- tokens (6c) ----------

export type TokenSpec = { name: string; image: string | null; typeLine: string };

/** Puts a new token onto the battlefield (in the tokens row). */
export function createToken(state: GameState, spec: TokenSpec): GameState {
  const n = (state.tokensMade ?? 0) + 1;
  const iid = `t${n}`;
  const inst: Instance = { iid, oracleId: "", name: spec.name, image: spec.image, typeLine: spec.typeLine, land: false, commander: false, token: true };
  return {
    ...state,
    tokensMade: n,
    cards: { ...state.cards, [iid]: inst },
    zones: { ...state.zones, battlefield: [...state.zones.battlefield, iid] },
    battlefield: { ...state.battlefield, [iid]: { x: 0, y: 0, tapped: false } },
  };
}

function removeCard(state: GameState, iid: string): GameState {
  const zones = { ...state.zones };
  for (const z of ZONES) zones[z] = zones[z].filter((x) => x !== iid);
  const cards = { ...state.cards };
  delete cards[iid];
  const battlefield = { ...state.battlefield };
  delete battlefield[iid];
  return { ...state, zones, cards, battlefield };
}
