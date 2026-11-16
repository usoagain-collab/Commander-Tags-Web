// Speed for the plays-like score (bracket rethink, step 1, David, Nov 15, 2026): the turn a deck threatens to win.
// 1,000 shuffled sample games, mana and pieces only: one land a turn, ramp cast when it can be, tutors fetch a
// missing piece. No opponents and no combat. Each game tracks the first turn each of the deck's win routes is
// ready; the threat turn is the median of the earliest route per game, the fast case the 25th percentile.
// Routes: two-card combos, cheat or reanimate, spell chains and commander damage (step 3, David, Nov 16, 2026), and
// the board (every deck). Pure logic: the caller hands in the cards with their tags.
import type { DeckLine } from "@/lib/deck/model";
import type { TagTree } from "@/lib/tags/tree";
import { cheatTargets, type CutterCard } from "@/lib/cutter/archetype";
import type { Archetype } from "@/lib/cutter/archetypes";
import { CHEAT_ENABLERS } from "@/lib/cutter/config";
import type { BracketEstimate } from "./evaluate";

export type RouteKey = "combo" | "cheat" | "chain" | "voltron" | "board";

/** Every tuning number in one place. */
export const SPEED = {
  games: 1000,
  /** Games stop here; a route not ready by then counts as turn maxTurn + 1 ("not by turn 12"). */
  maxTurn: 12,
  /** Speed points: full at this turn or sooner, none at `none` or later (WotC: bracket 4 games end around turn 4). */
  points: { max: 40, full: 4, none: 10 },
  /**
   * Board route: ready once the threats in play (creatures, planeswalkers, token makers) add up to this much. Each
   * threat counts `threatBase` plus half its mana value, so a 2-drop counts 3 and a 4-drop 4: cheap threats aren't
   * worth nothing next to big ones (with raw mana value, low-curve aggro decks never got there; laptop check, Nov 15).
   * A precon gets about five 4-drops down by turn 9, so fair decks land around turns 8-10.
   */
  boardPressure: 45,
  threatBase: 2,
  /** Cards a draw spell draws while the deck digs for a combo or cheat piece (cantrips draw 1 and replace themselves). */
  drawCards: 2,
  /** Cards a self-mill card puts into the graveyard (Scryfall tags don't carry the amount). */
  millCount: 3,
  /** With a picked or detected archetype that plays this way, the route turns on with fewer enablers. */
  pickedCheatEnablers: 2,
  /**
   * Spell chain (step 3): ready when a finisher is set up (or still being dug for with cantrips, with mana held back to cast it) and this many spells can be cast in one turn (rituals,
   * cantrips that replace themselves, cost reducers in play). The route turns on with a finisher and at least
   * `chainPieces` cheap instants and sorceries, rituals and cost reducers, or any finisher when the archetype is
   * Spellslinger. A rougher estimate than the others: no storm math, just "can it chain".
   */
  chainLength: 5,
  chainPieces: 12,
  /**
   * Commander damage (step 3): ready when the commander is out, its equipment and auras let it deal `voltronDamage`
   * a turn (21 in about three swings) and a protection piece is in play or castable. Cards carry no power, so the
   * commander counts its mana value as its power (at least 1; most voltron commanders are close) and each equipment or aura `boostPower`; double strike and
   * an extra combat each double it. Equipment costs `equipCost` more to attach. The route turns on for a creature
   * commander with at least `voltronBoosts` equipment and auras, or any when the archetype is Voltron.
   */
  voltronDamage: 7,
  voltronBoosts: 8,
  boostPower: 2,
  equipCost: 2,
  /** Archetypes whose plan is each route (keys from src/lib/cutter/archetypes.ts). */
  archetypeRoutes: {
    cheat: ["graveyard", "bigcreatures", "eldrazi"],
    combo: ["combo"],
    chain: ["spellslinger"],
    voltron: ["voltron"],
  } as Record<Exclude<RouteKey, "board">, string[]>,
};

/**
 * Mana that the best-known fast mana makes, by card name: what Scryfall's tags can't say (they carry the colors made,
 * not the amount). `tap` = mana each turn once in play; `once` = one-shot mana (rituals, Lotus Petal); `cost` replaces
 * the mana value when the card is really cast for less (Spirit Guides). Other ramp makes 1.
 */
export const FAST_MANA: Record<string, { tap?: number; once?: number; cost?: number }> = {
  "Sol Ring": { tap: 2 },
  "Mana Crypt": { tap: 2 },
  "Mana Vault": { tap: 3 },
  "Grim Monolith": { tap: 3 },
  "Basalt Monolith": { tap: 3 },
  "Thran Dynamo": { tap: 3 },
  "Gilded Lotus": { tap: 3 },
  "Hedron Archive": { tap: 2 },
  "Worn Powerstone": { tap: 2 },
  "Ancient Tomb": { tap: 2 },
  "City of Traitors": { tap: 2 },
  "Mox Diamond": { tap: 1 },
  "Chrome Mox": { tap: 1 },
  "Mox Opal": { tap: 1 },
  "Mox Amber": { tap: 1 },
  "Lotus Petal": { once: 1 },
  "Jeweled Lotus": { once: 3 },
  "Dark Ritual": { once: 3 },
  "Cabal Ritual": { once: 3 },
  "Rite of Flame": { once: 2 },
  "Seething Song": { once: 5 },
  "Simian Spirit Guide": { once: 1, cost: 0 },
  "Elvish Spirit Guide": { once: 1, cost: 0 },
  "Explosive Vegetation": { tap: 2 },
  "Skyshroud Claim": { tap: 2 },
};

/** Spell-chain finishers by name, beside the storm-count-matters tag: storm spells and cast-trigger wins. */
export const CHAIN_FINISHERS = new Set([
  "Grapeshot",
  "Brain Freeze",
  "Tendrils of Agony",
  "Empty the Warrens",
  "Mind's Desire",
  "Aetherflux Reservoir",
  "Thousand-Year Storm",
  "Haze of Rage",
  "Galvanic Relay",
  "Temporal Fissure",
  "Jeskai Ascendancy",
]);

/** Tags the sample games read. Each includes its subtree; missing slugs are simply ignored (checked in a test). */
export const SPEED_TAGS = {
  rock: ["mana-rock"],
  dork: ["mana-dork"],
  landRamp: ["land-ramp"],
  ritual: ["ritual"],
  mill: ["mill-self", "graveyard-fuel"],
  discard: ["discard-outlet", "loot"],
  fromLibrary: ["sneak-from-library"],
  tokens: ["repeatable-creature-tokens"],
  toGraveyard: ["tutor-to-graveyard"],
  toBattlefield: ["tutor-to-battlefield"],
  toTop: ["tutor-to-top"],
  // Step 3: spell chain and commander damage.
  reducer: ["cost-reducer-instant", "cost-reducer-sorcery", "cost-reducer-instant-sorcery"],
  untapper: ["untapper"],
  cantrip: ["cantrip"],
  chainPayoff: ["storm-count-matters"],
  doubleStrike: ["gives-double-strike"],
  extraCombat: ["extra-combat-phase"],
  /** What a tutor can find, by its tag. A tutor with none of these finds any nonland card. */
  finds: [
    ["tutor-creature", "Creature"],
    ["tutor-artifact", "Artifact"],
    ["tutor-enchantment", "Enchantment"],
    ["tutor-instant", "Instant"],
    ["tutor-sorcery", "Sorcery"],
    ["tutor-planeswalker", "Planeswalker"],
  ] as [string, string][],
};

/** Every slug the sample games use, for the tag-tree test and the check script. */
export const speedSlugs = () => [
  ...Object.entries(SPEED_TAGS).flatMap(([k, v]) => (k === "finds" ? (v as [string, string][]).map(([s]) => s) : (v as string[]))),
];

export type RouteSpeed = {
  key: RouteKey;
  label: string;
  /** Median turn the route is ready; maxTurn + 1 = not by maxTurn. */
  median: number;
  /** The turn it's ready in the fastest quarter of games. */
  fast: number;
  /** Share of games where it's the first route ready (ties go to every route ready that turn). */
  first: number;
  /** The route's pieces: combo cards, enablers and payoffs. Empty for the board. */
  cards: string[];
  /** One plain line on what the route is made of. */
  pieces: string;
};

export type SpeedEstimate = {
  games: number;
  /** Threat turn: median of the earliest ready route per game. maxTurn + 1 = not by maxTurn. */
  turn: number;
  fast: number;
  /** The route that's ready first most often. */
  route: RouteSpeed;
  routes: RouteSpeed[];
  points: number;
  /** The archetype that steered which routes were checked, and whether the owner picked it. */
  archetype: { key: string; name: string; picked: boolean } | null;
};

export type SpeedInput = {
  /** The 100-card deck: commander, companion and mainboard. */
  lines: DeckLine[];
  tagsOf: (oracleId: string) => string[];
  /** Standard roles from the card's tags (bracketRolesOf). */
  rolesOf: (line: DeckLine) => string[];
  tree: TagTree;
  estimate: BracketEstimate;
  /** The Plays line's archetype when the owner picked one, otherwise the detected one (null for General). */
  archetype?: { archetype: Archetype; picked: boolean } | null;
};

export const ROUTE_LABELS: Record<RouteKey, string> = {
  combo: "two-card combo",
  cheat: "cheat or reanimate",
  chain: "spell chain",
  voltron: "commander damage",
  board: "board",
};

/** Speed points for a threat turn. */
export const speedPoints = (turn: number) => {
  const { max, full, none } = SPEED.points;
  return max * Math.min(1, Math.max(0, (none - turn) / (none - full)));
};

/** "turn 6", or "after turn 12" for the not-ready sentinel. */
export const turnWords = (turn: number) => (turn > SPEED.maxTurn ? `after turn ${SPEED.maxTurn}` : `turn ${turn}`);

// ---------- card kinds ----------

type Kind = {
  id: string;
  /** Front face type line. */
  type: string;
  mv: number;
  /** Mana value to pay (Spirit Guides: 0). */
  cost: number;
  land: boolean;
  landMana: number;
  permanent: boolean;
  creature: boolean;
  /** Mana each turn once in play, and from which turn: 0 = the turn it's cast (rocks), 1 = the next (dorks, land ramp). */
  tap: number;
  sick: number;
  /** One-shot mana, net of its own cost. */
  once: number;
  tutor: null | { finds: (k: Kind) => boolean; to: "hand" | "graveyard" | "battlefield" | "top" };
  reanimator: boolean;
  sneak: boolean;
  fromLibrary: boolean;
  payoff: boolean;
  mill: boolean;
  discard: boolean;
  /** A draw card (standard Draw role) that isn't a threat, payoff, tutor or ramp. */
  draw: boolean;
  /** A noncreature draw permanent (Rhystic Study, Phyrexian Arena): draws a card every turn once in play. */
  engine: boolean;
  /** Mana it adds to the board route (0 = not a threat). */
  threat: number;
  commander: boolean;
  /** An instant or sorcery (front face): the spell chain's fuel. */
  spell: boolean;
  /** Makes instants and sorceries cost 1 less once in play. */
  reducer: boolean;
  /** Draws a card when cast, so it replaces itself in a chain. */
  cantrip: boolean;
  /** A spell-chain finisher (storm spell or cast-trigger win). */
  chainPayoff: boolean;
  /** Equipment or a non-removal aura: power for the commander. */
  boost: boolean;
  doubleStrike: boolean;
  extraCombat: boolean;
  protection: boolean;
};

const front = (typeLine: string) => typeLine.split(" // ")[0];

function kindsOf(input: SpeedInput, payoffs: Set<string>): Kind[] {
  const { tree } = input;
  const set = (slugs: string[]) => tree.descendants(slugs.filter((s) => tree.has(s)));
  const sets = Object.fromEntries(Object.entries(SPEED_TAGS).filter(([k]) => k !== "finds").map(([k, v]) => [k, set(v as string[])])) as Record<
    Exclude<keyof typeof SPEED_TAGS, "finds">,
    Set<string>
  >;
  const finders = SPEED_TAGS.finds.map(([slug, type]) => ({ tags: set([slug]), type: new RegExp(`\\b${type}\\b`) }));
  const not = set(CHEAT_ENABLERS.not);
  const reanimate = set(CHEAT_ENABLERS.reanimate);
  const putIntoPlay = set(CHEAT_ENABLERS.putIntoPlay);
  const has = (tags: string[], s: Set<string>) => tags.some((t) => s.has(t));
  const enables = (tags: string[], s: Set<string>) => tags.some((t) => s.has(t) && !not.has(t));

  return input.lines.map((l) => {
    const c = l.card;
    const tags = input.tagsOf(c.oracle_id);
    const roles = input.rolesOf(l);
    const type = front(c.type_line);
    const land = c.counts_as_land ?? /\bLand\b/.test(type);
    const permanent = !/\b(Instant|Sorcery)\b/.test(type);
    const creature = /\bCreature\b/.test(type);
    const known = FAST_MANA[c.name] ?? {};
    const ramp = !land && roles.includes("ramp");
    const ritual = !land && has(tags, sets.ritual);
    let tap = land ? 0 : (known.tap ?? 0);
    let sick = 0;
    let once = !land && known.once !== undefined ? known.once - (known.cost ?? c.mana_value) : 0;
    if (!land && !tap && !once) {
      if (ritual || has(tags, sets.untapper)) once = 1;
      else if (ramp) {
        tap = 1;
        // Rocks make mana the turn they land; dorks, land ramp and the rest from the next turn.
        sick = has(tags, sets.rock) && !has(tags, sets.dork) ? 0 : 1;
      }
    } else if (!land && tap && (has(tags, sets.dork) || has(tags, sets.landRamp))) sick = 1;

    let tutor: Kind["tutor"] = null;
    if (!land && roles.includes("tutors")) {
      const mine = finders.filter((f) => has(tags, f.tags));
      const to = has(tags, sets.toGraveyard) ? "graveyard" : has(tags, sets.toBattlefield) ? "battlefield" : has(tags, sets.toTop) ? "top" : "hand";
      tutor = { finds: (k) => !k.land && (!mine.length || mine.some((f) => f.type.test(k.type))), to };
    }
    const threatType = creature || /\bPlaneswalker\b/.test(type);
    const drawCard = !land && roles.includes("draw") && !roles.includes("ramp") && !roles.includes("tutors") && !payoffs.has(c.oracle_id);
    const reanimator = !land && enables(tags, reanimate);
    const sneak = !land && enables(tags, putIntoPlay);
    return {
      id: c.oracle_id,
      type,
      mv: c.mana_value,
      cost: known.cost ?? c.mana_value,
      land,
      landMana: land ? (known.tap ?? 1) : 0,
      permanent,
      creature,
      tap,
      sick,
      once,
      tutor,
      reanimator,
      sneak,
      fromLibrary: sneak && has(tags, sets.fromLibrary),
      payoff: payoffs.has(c.oracle_id),
      mill: !land && has(tags, sets.mill),
      discard: !land && has(tags, sets.discard),
      // Draw cards that aren't threats: a spell draws once, a noncreature permanent (Rhystic Study) every turn.
      // Creatures and planeswalkers that draw are cast as threats instead (laptop check, Nov 15: casting them as draw
      // spells cost decks their board).
      draw: drawCard && !threatType,
      engine: drawCard && !threatType && permanent,
      threat: !land && (creature || /\bPlaneswalker\b/.test(type) || has(tags, sets.tokens)) ? SPEED.threatBase + c.mana_value / 2 : 0,
      commander: l.board === "commander",
      spell: !land && !permanent,
      reducer: !land && permanent && has(tags, sets.reducer),
      cantrip: !land && has(tags, sets.cantrip),
      chainPayoff: !land && (CHAIN_FINISHERS.has(c.name) || has(tags, sets.chainPayoff)),
      boost: !land && (/\bEquipment\b/.test(type) || (/\bAura\b/.test(type) && !roles.includes("removal"))),
      doubleStrike: !land && has(tags, sets.doubleStrike),
      extraCombat: !land && has(tags, sets.extraCombat),
      protection: !land && roles.includes("protection"),
    };
  });
}

// ---------- random ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ---------- the sample games ----------

type Combo = { pieces: number[] };

const cache = new Map<string, SpeedEstimate>();
/** For tests: forget remembered results so the next call plays the games again. */
export const clearSpeedCache = () => cache.clear();

export function estimateSpeed(input: SpeedInput): SpeedEstimate {
  const arch = input.archetype ?? null;
  const archKey = arch?.archetype.key ?? null;
  const calls = (route: Exclude<RouteKey, "board">) => !!archKey && SPEED.archetypeRoutes[route].includes(archKey);

  // Combos: Spellbook-rated two-card combos fully in the deck. Exhibition ones (slow, a lot of setup) count only
  // when the deck plays as Combo.
  const comboFindings = input.estimate.findings.filter((f) => f.combo && (f.minBracket > 1 || calls("combo")));

  // Cheat targets: the Smart Cutter's own rule (6+ mana value, enough enablers), with fewer enablers needed when the
  // archetype plays this way.
  const cutterCards: CutterCard[] = input.lines.map((l) => ({
    card: l.card,
    quantity: l.quantity,
    commander: l.board === "commander",
    tags: input.tagsOf(l.card.oracle_id),
    roles: input.rolesOf(l),
  }));
  const cheatArch: Archetype | undefined = calls("cheat")
    ? { ...arch!.archetype, cheat: { ...arch!.archetype.cheat, enablers: Math.min(arch!.archetype.cheat?.enablers ?? 99, SPEED.pickedCheatEnablers) } }
    : arch?.archetype;
  const cheat = cheatTargets(cutterCards, input.tree, cheatArch);

  const key = [
    input.lines.map((l) => `${l.board[0]}${l.card.oracle_id}:${l.quantity}`).join("|"),
    comboFindings.map((f) => f.cards.join("+")).join(","),
    [...cheat.targets].sort().join(","),
    archKey ?? "",
  ].join("#");
  const hit = cache.get(key);
  if (hit) return { ...hit, archetype: arch ? { key: arch.archetype.key, name: arch.archetype.name, picked: arch.picked } : null };

  const kinds = kindsOf(input, cheat.targets);
  const index = new Map(kinds.map((k, i) => [k.id, i]));
  const combos: Combo[] = comboFindings
    .map((f) => ({ pieces: f.cards.map((id) => index.get(id)).filter((i): i is number => i !== undefined) }))
    .filter((c) => c.pieces.length === 2);
  const enablers = kinds.filter((k) => k.reanimator || k.sneak || (k.tutor?.to === "battlefield" && kinds.some((p) => p.payoff && p.creature)));
  const routes: RouteKey[] = ["board"];
  if (combos.length) routes.unshift("combo");
  if (cheat.targets.size && enablers.length) routes.unshift("cheat");
  // Spell chain: a finisher plus enough cheap spells, rituals and cost reducers (any finisher for Spellslinger).
  const copies = (k: Kind) => input.lines[kinds.indexOf(k)].quantity;
  const finishers = kinds.filter((k) => k.chainPayoff);
  const chainFuel = kinds.filter((k) => !k.chainPayoff && ((k.spell && k.cost <= 2) || k.reducer || k.once > 0)).reduce((n, k) => n + copies(k), 0);
  if (finishers.length && (chainFuel >= SPEED.chainPieces || calls("chain"))) routes.unshift("chain");
  // Commander damage: a creature commander with enough equipment and auras (any for Voltron).
  const champion = kinds.findIndex((k) => k.commander && k.creature);
  const boosts = kinds.filter((k) => k.boost || ((k.doubleStrike || k.extraCombat) && !k.creature));
  const boostCount = boosts.reduce((n, k) => n + copies(k), 0);
  if (champion >= 0 && boostCount && (boostCount >= SPEED.voltronBoosts || calls("voltron"))) routes.unshift("voltron");

  const reanimates = enablers.some((k) => k.reanimator);
  const sneaks = enablers.some((k) => !k.reanimator);
  const commanders = kinds.map((k, i) => (k.commander ? i : -1)).filter((i) => i >= 0);
  const deck: number[] = [];
  input.lines.forEach((l, i) => {
    if (!kinds[i].commander) for (let q = 0; q < l.quantity; q++) deck.push(i);
  });

  const rand = mulberry32(hash(key));
  const ready: Record<RouteKey, number[]> = { combo: [], cheat: [], chain: [], voltron: [], board: [] };
  const earliest: number[] = [];
  const firstCount: Record<RouteKey, number> = { combo: 0, cheat: 0, chain: 0, voltron: 0, board: 0 };
  const never = SPEED.maxTurn + 1;

  for (let g = 0; g < SPEED.games; g++) {
    const lib = deck.slice();
    for (let i = lib.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [lib[i], lib[j]] = [lib[j], lib[i]];
    }
    let hand = lib.splice(0, 7);
    const handLands = hand.filter((i) => kinds[i].land).length;
    if (handLands < 2 || handLands > 5) {
      // One free mulligan, keep whatever comes.
      lib.push(...hand);
      for (let i = lib.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [lib[i], lib[j]] = [lib[j], lib[i]];
      }
      hand = lib.splice(0, 7);
    }
    const inPlay = new Set<number>(); // permanents cast (combo pieces, threats)
    const zone = new Set<number>(commanders); // commanders still in the command zone
    const gy: number[] = [];
    let landMana = 0;
    let tapMana = 0;
    let pending = 0;
    let threat = 0;
    let pressure = 0;
    let engines = 0;
    let boostPower = 0;
    let doubled = 0; // double strike and extra combats in play, each doubling the commander's damage
    const done: Record<RouteKey, number> = { combo: never, cheat: never, chain: never, voltron: never, board: never };

    const take = (from: number[], i: number) => {
      const at = from.indexOf(i);
      if (at >= 0) from.splice(at, 1);
      return at >= 0;
    };
    const handMana = () => hand.reduce((n, i) => n + Math.max(0, kinds[i].once), 0);
    const available = (i: number) => inPlay.has(i) || hand.includes(i) || zone.has(i);
    /** Casts these draw cards, cheapest first, while mana lasts: a spell draws now, an engine every turn after. */
    const castDraw = (cards: number[], mana: number) => {
      for (const i of cards.sort((a, b) => kinds[a].cost - kinds[b].cost)) {
        if (kinds[i].cost > mana) break;
        take(hand, i);
        mana -= kinds[i].cost;
        if (kinds[i].engine) engines += 1;
        else hand.push(...lib.splice(0, SPEED.drawCards));
      }
      return mana;
    };
    const costToFinish = (c: Combo) => c.pieces.reduce((n, i) => n + (inPlay.has(i) ? 0 : kinds[i].cost), 0);

    const check = (turn: number, mana: number) => {
      const m = mana + handMana();
      if (done.combo === never && combos.some((c) => c.pieces.every(available) && costToFinish(c) <= m)) done.combo = turn;
      if (done.cheat === never && routes.includes("cheat")) {
        const enablerIn = [...hand, ...zone].filter((i) => kinds[i].cost <= m);
        const ok = enablerIn.some((i) => {
          const k = kinds[i];
          if (k.reanimator && gy.some((p) => kinds[p].payoff && kinds[p].creature)) return true;
          if (k.sneak && hand.some((p) => kinds[p].payoff && p !== i)) return true;
          if ((k.fromLibrary || k.tutor?.to === "battlefield") && lib.some((p) => kinds[p].payoff && (k.fromLibrary || k.tutor!.finds(kinds[p])))) return true;
          return false;
        });
        if (ok) done.cheat = turn;
      }
      if (done.chain === never && routes.includes("chain") && chainReady(mana)) done.chain = turn;
      if (done.voltron === never && routes.includes("voltron") && voltronReady(mana)) done.voltron = turn;
      if (done.board === never && pressure >= SPEED.boardPressure) done.board = turn;
    };

    /** Instants and sorceries cost 1 less per cost reducer in play, never below 1 (colored mana stays). */
    const spellCost = (i: number) => {
      const reducers = [...inPlay].filter((x) => kinds[x].reducer).length;
      const k = kinds[i];
      return k.spell && k.cost > 0 ? Math.max(1, k.cost - reducers) : k.cost;
    };
    /** Could the deck chain enough spells this turn into a finisher? Rituals first, then cheapest; cantrips draw. */
    const chainReady = (mana: number) => {
      const permFinisher = [...inPlay].some((i) => kinds[i].chainPayoff);
      let spellFinisher: number | undefined = hand.filter((i) => kinds[i].chainPayoff && kinds[i].spell).sort((a, b) => spellCost(a) - spellCost(b))[0];
      // With no finisher yet, the chain can still dig for one with cantrips.
      if (!permFinisher && spellFinisher === undefined && !hand.some((i) => kinds[i].cantrip)) return false;
      let m = mana + hand.filter((i) => !kinds[i].spell && kinds[i].once > 0).reduce((n, i) => n + kinds[i].once, 0);
      const pool = hand.filter((i) => kinds[i].spell && i !== spellFinisher);
      let top = 0;
      let count = 0;
      // Mana held back for the finisher (a typical 2 while it's still being dug for).
      const reserve = () => (permFinisher ? 0 : spellFinisher !== undefined ? spellCost(spellFinisher) : 2);
      for (;;) {
        const ritual = pool.filter((i) => kinds[i].once > 0 && spellCost(i) <= m).sort((a, b) => kinds[b].once - kinds[a].once)[0];
        const next = ritual ?? pool.filter((i) => spellCost(i) <= m - reserve()).sort((a, b) => spellCost(a) - spellCost(b))[0];
        if (next === undefined) break;
        pool.splice(pool.indexOf(next), 1);
        m += kinds[next].once + (kinds[next].once > 0 ? kinds[next].cost : 0) - spellCost(next);
        count += 1;
        if (kinds[next].cantrip && top < lib.length) {
          const drawn = lib[top++];
          if (kinds[drawn].chainPayoff && kinds[drawn].spell && spellFinisher === undefined) spellFinisher = drawn;
          else if (kinds[drawn].spell) pool.push(drawn);
        }
      }
      return count >= SPEED.chainLength && (permFinisher || (spellFinisher !== undefined && reserve() <= m));
    };
    /** Is the commander out, strong enough to kill in about three swings, and protected? */
    const voltronReady = (mana: number) => {
      if (!inPlay.has(champion)) return false;
      const base = Math.max(1, kinds[champion].mv);
      let m = mana;
      // An instant that grants double strike or an extra combat, castable now, counts too.
      const trick = doubled ? undefined : hand.find((i) => !kinds[i].permanent && (kinds[i].doubleStrike || kinds[i].extraCombat) && kinds[i].cost <= m);
      if (trick !== undefined) m -= kinds[trick].cost;
      const damage = (base + boostPower) * 2 ** Math.min(2, doubled + (trick !== undefined ? 1 : 0));
      const shielded = [...inPlay].some((i) => kinds[i].protection) || hand.some((i) => kinds[i].protection && kinds[i].cost <= m);
      return damage >= SPEED.voltronDamage && shielded;
    };
    /** Puts a permanent from hand into play: cost paid, threat added, chain and voltron effects tracked. */
    const cast = (i: number, extra = 0) => {
      take(hand, i);
      inPlay.add(i);
      if (kinds[i].boost) boostPower += SPEED.boostPower;
      if (kinds[i].doubleStrike || kinds[i].extraCombat) doubled += 1;
      return kinds[i].cost + extra;
    };

    /** Cards a tutor could usefully find right now, most useful first: a combo piece, or a cheat piece. */
    const wanted = (): number[] => {
      const out: number[] = [];
      // Combo halves: the combo closest to done first (one piece missing, then both).
      if (done.combo === never)
        for (const missing of combos.map((c) => c.pieces.filter((i) => !available(i))).sort((a, b) => a.length - b.length)) out.push(...missing);
      if (done.cheat === never && routes.includes("cheat")) {
        // A payoff where the deck's enablers can use it (in the graveyard for reanimation, in hand for sneaking),
        // and an enabler in hand. Entomb-style tutors put the payoff straight into the graveyard.
        const payoffReady = gy.some((i) => kinds[i].payoff && kinds[i].creature) || (sneaks && hand.some((i) => kinds[i].payoff));
        const enablerIn = [...hand, ...zone].some((i) => kinds[i].reanimator || kinds[i].sneak);
        if (!payoffReady) out.push(...lib.filter((i) => kinds[i].payoff));
        if (!enablerIn) out.push(...lib.filter((i) => kinds[i].reanimator || kinds[i].sneak));
      }
      // A spell-chain finisher when none is in hand or play; a protection piece for a commander that's out.
      if (done.chain === never && routes.includes("chain") && ![...hand, ...inPlay].some((i) => kinds[i].chainPayoff)) out.push(...lib.filter((i) => kinds[i].chainPayoff));
      if (done.voltron === never && routes.includes("voltron") && inPlay.has(champion) && ![...hand, ...inPlay].some((i) => kinds[i].protection))
        out.push(...lib.filter((i) => kinds[i].protection));
      return out;
    };

    for (let turn = 1; turn <= SPEED.maxTurn && routes.some((r) => done[r] === never); turn++) {
      if (turn > 1 && lib.length) hand.push(lib.shift()!);
      // Draw engines in play draw one more each.
      if (engines) hand.push(...lib.splice(0, engines));
      tapMana += pending;
      pending = 0;
      // Threats already in play attack: the board route adds up their pressure turn by turn.
      pressure += threat;
      // Land drop: the land that makes the most.
      const lands = hand.filter((i) => kinds[i].land).sort((a, b) => kinds[b].landMana - kinds[a].landMana);
      if (lands.length) {
        take(hand, lands[0]);
        landMana += kinds[lands[0]].landMana;
      }
      let mana = landMana + tapMana;
      check(turn, mana);

      // Ramp, cheapest first.
      for (const i of hand.filter((x) => kinds[x].tap > 0).sort((a, b) => kinds[a].cost - kinds[b].cost)) {
        if (kinds[i].cost > mana) break;
        take(hand, i);
        mana -= kinds[i].cost;
        if (kinds[i].sick) pending += kinds[i].tap;
        else {
          tapMana += kinds[i].tap;
          mana += kinds[i].tap;
        }
      }
      check(turn, mana);

      // Commander damage: the commander goes down as soon as it can, then its equipment and auras, cheapest first.
      if (routes.includes("voltron") && done.voltron === never) {
        if (zone.has(champion) && kinds[champion].cost <= mana) {
          zone.delete(champion);
          inPlay.add(champion);
          mana -= kinds[champion].cost;
          threat += kinds[champion].threat;
        }
        if (inPlay.has(champion)) {
          for (const i of hand.filter((x) => kinds[x].permanent && (kinds[x].boost || kinds[x].doubleStrike || kinds[x].extraCombat)).sort((a, b) => kinds[a].cost - kinds[b].cost)) {
            const extra = /\bEquipment\b/.test(kinds[i].type) ? SPEED.equipCost : 0;
            if (kinds[i].cost + extra > mana) continue;
            mana -= cast(i, extra);
          }
        }
        check(turn, mana);
      }

      // Tutors fetch a missing piece.
      for (let n = 0; n < 2; n++) {
        const want = wanted();
        if (!want.length) break;
        const t = hand.find((i) => kinds[i].tutor && kinds[i].cost <= mana && want.some((w) => kinds[i].tutor!.finds(kinds[w])));
        if (t === undefined) break;
        const tutor = kinds[t].tutor!;
        const found = want.find((w) => tutor.finds(kinds[w]) && lib.includes(w));
        take(hand, t);
        mana -= kinds[t].cost;
        if (found === undefined) continue;
        take(lib, found);
        if (tutor.to === "graveyard") gy.push(found);
        else if (tutor.to === "top") lib.unshift(found);
        else hand.push(found);
      }
      check(turn, mana);

      // Fill the graveyard for reanimation, cheapest card first, until a payoff is there: a discard outlet or
      // looter draws a card and pitches a payoff from hand; a self-mill card mills a few.
      if (reanimates && done.cheat === never) {
        for (let n = 0; n < 3 && !gy.some((i) => kinds[i].payoff && kinds[i].creature); n++) {
          const filler = hand.filter((i) => (kinds[i].discard || kinds[i].mill) && kinds[i].cost <= mana).sort((a, b) => kinds[a].cost - kinds[b].cost)[0];
          if (filler === undefined) break;
          take(hand, filler);
          mana -= kinds[filler].cost;
          if (kinds[filler].mill) gy.push(...lib.splice(0, SPEED.millCount));
          else {
            if (lib.length) hand.push(lib.shift()!);
            const payoff = hand.find((i) => kinds[i].payoff && kinds[i].creature);
            if (payoff !== undefined) {
              take(hand, payoff);
              gy.push(payoff);
            }
          }
        }
        check(turn, mana);
      }

      // Digging: while a combo or cheat route is still missing pieces, cheap draw spells come before threats.
      if ((routes.includes("combo") && done.combo === never) || (routes.includes("cheat") && done.cheat === never)) {
        mana = castDraw(hand.filter((x) => kinds[x].draw), mana);
        check(turn, mana);
      }

      // Spell chain: cost reducers and permanent finishers (Aetherflux Reservoir) go down before threats.
      if (routes.includes("chain") && done.chain === never) {
        for (const i of hand.filter((x) => kinds[x].permanent && (kinds[x].reducer || kinds[x].chainPayoff)).sort((a, b) => kinds[a].cost - kinds[b].cost)) {
          if (kinds[i].cost > mana) continue;
          mana -= cast(i);
          if (kinds[i].creature) threat += kinds[i].threat;
        }
        check(turn, mana);
      }

      // Draw engines go down before threats: they pay off every turn after.
      mana = castDraw(hand.filter((x) => kinds[x].engine), mana);

      // Combo pieces that are permanents go down when there's spare mana.
      for (const c of combos)
        for (const i of c.pieces)
          if (!inPlay.has(i) && kinds[i].permanent && available(i) && kinds[i].cost <= mana && c.pieces.every(available)) {
            if (zone.has(i)) zone.delete(i);
            else take(hand, i);
            inPlay.add(i);
            mana -= kinds[i].cost;
          }

      // Threats with what's left, biggest that fits first; the commander when it fits.
      for (const i of [...zone].filter((x) => kinds[x].threat && kinds[x].cost <= mana)) {
        zone.delete(i);
        inPlay.add(i);
        mana -= kinds[i].cost;
        threat += kinds[i].threat;
      }
      for (const i of hand.filter((x) => kinds[x].threat && !kinds[x].payoff).sort((a, b) => kinds[b].cost - kinds[a].cost)) {
        if (kinds[i].cost > mana) continue;
        take(hand, i);
        inPlay.add(i);
        mana -= kinds[i].cost;
        threat += kinds[i].threat;
      }
      // Payoffs get hard-cast only when nothing better is left to do with the mana.
      for (const i of hand.filter((x) => kinds[x].threat && kinds[x].payoff)) {
        if (kinds[i].cost > mana) continue;
        take(hand, i);
        inPlay.add(i);
        mana -= kinds[i].cost;
        threat += kinds[i].threat;
      }
      // Mana left over goes into draw spells, so a deck that draws keeps finding threats (it used to draw only while
      // digging for a combo or cheat piece). What it draws can be cast with whatever is still left.
      const before = hand.length;
      mana = castDraw(hand.filter((x) => kinds[x].draw), mana);
      if (hand.length !== before)
        for (const i of hand.filter((x) => kinds[x].threat).sort((a, b) => kinds[b].cost - kinds[a].cost)) {
          if (kinds[i].cost > mana) continue;
          take(hand, i);
          inPlay.add(i);
          mana -= kinds[i].cost;
          threat += kinds[i].threat;
        }
      check(turn, mana);
    }

    const first = Math.min(...routes.map((r) => done[r]));
    earliest.push(first);
    for (const r of routes) {
      ready[r].push(done[r]);
      if (done[r] === first && first !== never) firstCount[r] += 1;
    }
  }

  const quantile = (xs: number[], q: number) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  };
  const enablerIds = new Set(enablers.map((k) => k.id));
  const routeOut: RouteSpeed[] = routes.map((r) => ({
    key: r,
    label: ROUTE_LABELS[r],
    median: quantile(ready[r], 0.5),
    fast: quantile(ready[r], 0.25),
    first: firstCount[r] / SPEED.games,
    cards:
      r === "combo"
        ? [...new Set(combos.flatMap((c) => c.pieces.map((i) => kinds[i].id)))]
        : r === "cheat"
          ? [...enablerIds, ...[...cheat.targets].filter((id) => !enablerIds.has(id))]
          : r === "chain"
            ? [...new Set([...finishers, ...kinds.filter((k) => k.reducer)].map((k) => k.id))]
            : r === "voltron"
              ? [...new Set([kinds[champion], ...boosts].map((k) => k.id))]
              : [],
    pieces:
      r === "combo"
        ? `${combos.length} two-card ${combos.length === 1 ? "combo" : "combos"}`
        : r === "cheat"
          ? `${enablers.length} ${enablers.length === 1 ? "enabler" : "enablers"} and ${cheat.targets.size} ${cheat.targets.size === 1 ? "payoff" : "payoffs"} at mana value 6+`
          : r === "chain"
            ? `${finishers.length} ${finishers.length === 1 ? "finisher" : "finishers"} and ${chainFuel} cheap spells, rituals and cost reducers`
            : r === "voltron"
              ? `${input.lines[champion].card.name} with ${boostCount} equipment and auras`
              : "creatures, planeswalkers and token makers",
  }));
  const route = routeOut.slice().sort((a, b) => b.first - a.first || a.median - b.median)[0];
  const turn = quantile(earliest, 0.5);
  const out: SpeedEstimate = {
    games: SPEED.games,
    turn,
    fast: quantile(earliest, 0.25),
    route,
    routes: routeOut,
    points: speedPoints(turn),
    archetype: arch ? { key: arch.archetype.key, name: arch.archetype.name, picked: arch.picked } : null,
  };
  if (cache.size > 20) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}
