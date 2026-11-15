// Speed for the plays-like score (bracket rethink, step 1, David, Nov 15, 2026): the turn a deck threatens to win.
// 1,000 shuffled sample games, mana and pieces only: one land a turn, ramp cast when it can be, tutors fetch a
// missing piece. No opponents and no combat. Each game tracks the first turn each of the deck's win routes is
// ready; the threat turn is the median of the earliest route per game, the fast case the 25th percentile.
// Routes in this step: two-card combos, cheat or reanimate, and the board (every deck). Spell chains and
// commander damage come in step 3. Pure logic: the caller hands in the cards with their tags.
import type { DeckLine } from "@/lib/deck/model";
import type { TagTree } from "@/lib/tags/tree";
import { cheatTargets, type CutterCard } from "@/lib/cutter/archetype";
import type { Archetype } from "@/lib/cutter/archetypes";
import { CHEAT_ENABLERS } from "@/lib/cutter/config";
import type { BracketEstimate } from "./evaluate";

export type RouteKey = "combo" | "cheat" | "board";

/** Every tuning number in one place. */
export const SPEED = {
  games: 1000,
  /** Games stop here; a route not ready by then counts as turn maxTurn + 1 ("not by turn 12"). */
  maxTurn: 12,
  /** Speed points: full at this turn or sooner, none at `none` or later (WotC: bracket 4 games end around turn 4). */
  points: { max: 40, full: 4, none: 10 },
  /**
   * Board route: ready once this much mana has gone into creatures, planeswalkers and token makers. A precon has
   * spent about 50 mana by turn 9, nearly half on threats, so fair decks land around turns 8-10 (to tune on precons).
   */
  boardThreat: 18,
  /** Cards a draw spell draws while the deck digs for a combo or cheat piece (cantrips draw 1 and replace themselves). */
  drawCards: 2,
  /** Cards a self-mill card puts into the graveyard (Scryfall tags don't carry the amount). */
  millCount: 3,
  /** With a picked or detected archetype that plays this way, the route turns on with fewer enablers. */
  pickedCheatEnablers: 2,
  /** Archetypes whose plan is each route (keys from src/lib/cutter/archetypes.ts). */
  archetypeRoutes: {
    cheat: ["graveyard", "bigcreatures", "eldrazi"],
    combo: ["combo"],
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

export const ROUTE_LABELS: Record<RouteKey, string> = { combo: "two-card combo", cheat: "cheat or reanimate", board: "board" };

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
  /** A draw spell (standard Draw role), not a payoff, tutor or ramp. */
  draw: boolean;
  /** Mana it adds to the board route (0 = not a threat). */
  threat: number;
  commander: boolean;
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
      if (ritual) once = 1;
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
      draw: !land && roles.includes("draw") && !roles.includes("ramp") && !roles.includes("tutors") && !payoffs.has(c.oracle_id),
      threat: !land && (creature || /\bPlaneswalker\b/.test(type) || has(tags, sets.tokens)) ? Math.max(1, c.mana_value) : 0,
      commander: l.board === "commander",
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

  const reanimates = enablers.some((k) => k.reanimator);
  const sneaks = enablers.some((k) => !k.reanimator);
  const commanders = kinds.map((k, i) => (k.commander ? i : -1)).filter((i) => i >= 0);
  const deck: number[] = [];
  input.lines.forEach((l, i) => {
    if (!kinds[i].commander) for (let q = 0; q < l.quantity; q++) deck.push(i);
  });

  const rand = mulberry32(hash(key));
  const ready: Record<RouteKey, number[]> = { combo: [], cheat: [], board: [] };
  const earliest: number[] = [];
  const firstCount: Record<RouteKey, number> = { combo: 0, cheat: 0, board: 0 };
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
    const done: Record<RouteKey, number> = { combo: never, cheat: never, board: never };

    const take = (from: number[], i: number) => {
      const at = from.indexOf(i);
      if (at >= 0) from.splice(at, 1);
      return at >= 0;
    };
    const handMana = () => hand.reduce((n, i) => n + Math.max(0, kinds[i].once), 0);
    const available = (i: number) => inPlay.has(i) || hand.includes(i) || zone.has(i);
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
      if (done.board === never && threat >= SPEED.boardThreat) done.board = turn;
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
      return out;
    };

    for (let turn = 1; turn <= SPEED.maxTurn && routes.some((r) => done[r] === never); turn++) {
      if (turn > 1 && lib.length) hand.push(lib.shift()!);
      tapMana += pending;
      pending = 0;
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
        for (const i of hand.filter((x) => kinds[x].draw).sort((a, b) => kinds[a].cost - kinds[b].cost)) {
          if (kinds[i].cost > mana) break;
          take(hand, i);
          mana -= kinds[i].cost;
          hand.push(...lib.splice(0, SPEED.drawCards));
        }
        check(turn, mana);
      }

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
          : [],
    pieces:
      r === "combo"
        ? `${combos.length} two-card ${combos.length === 1 ? "combo" : "combos"}`
        : r === "cheat"
          ? `${enablers.length} ${enablers.length === 1 ? "enabler" : "enablers"} and ${cheat.targets.size} ${cheat.targets.size === 1 ? "payoff" : "payoffs"} at mana value 6+`
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
