// PR 1 gates: 1,000 random games. Every action is checked against the invariants, every rollback must
// return the exact pre-cast state, and every game replayed from its log must end in an identical state.
import { describe, expect, it } from "vitest";
import { stateDigest } from "./digest";
import { step } from "./engine";
import { deepFreeze } from "./freeze";
import { checkInvariants } from "./invariants";
import { newLog, replay, type GameLog } from "./log";
import { randomAction } from "./random-player";
import { seedRng } from "./rng";
import { createGame, type GameSetup } from "./setup";
import { mixedDeck } from "./test-cards";
import type { GameState } from "./types";

const GAMES = 1000;
const MAX_ACTIONS = 600;

type Played = { log: GameLog; end: GameState; problems: string[]; rollbacks: number; badRollbacks: number; actions: number };

function playRandom(seed: number): Played {
  const players = 2 + (seed % 3);
  const setup: GameSetup = { seed, seats: Array.from({ length: players }, (_, i) => ({ deck: mixedDeck(24 + ((seed + i) % 17)) })) };
  const log = newLog(setup);
  let s = deepFreeze(createGame(setup).state);
  const problems = checkInvariants(s).map((p) => `start: ${p}`);
  let rng = seedRng(`player-${seed}`);
  let rollbacks = 0;
  let badRollbacks = 0;
  while (!s.over && log.actions.length < MAX_ACTIONS) {
    const pick = randomAction(s, rng, { concedeChance: 0.0005 })!;
    rng = pick.rng;
    log.actions.push({ seat: pick.seat, action: pick.action });
    const r = step(s, pick.seat, pick.action);
    if (r.events.some((e) => e.type === "castRolledBack")) {
      rollbacks++;
      if (r.state !== s.casting?.checkpoint) badRollbacks++;
    }
    s = deepFreeze(r.state); // a stray mutation in the engine throws in the next step
    for (const p of checkInvariants(s)) problems.push(`seed ${seed}, action ${log.actions.length}: ${p}`);
    if (r.error) problems.push(`seed ${seed}, action ${log.actions.length}: random player sent a refused action: ${r.error}`);
  }
  return { log, end: s, problems, rollbacks, badRollbacks, actions: log.actions.length };
}

describe(`${GAMES} random games`, { timeout: 120_000 }, () => {
  const results: Played[] = [];
  for (let seed = 1; seed <= GAMES; seed++) results.push(playRandom(seed));

  it("hold every invariant after every action", () => {
    const problems = results.flatMap((r) => r.problems);
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it("roll back every unpayable or cancelled cast to the exact earlier state", () => {
    const total = results.reduce((n, r) => n + r.rollbacks, 0);
    expect(total).toBeGreaterThan(100); // the random player does hit this path
    expect(results.reduce((n, r) => n + r.badRollbacks, 0)).toBe(0);
  });

  it("end in an identical state when replayed from their logs", () => {
    let mismatches = 0;
    for (const r of results) {
      const again = replay(JSON.parse(JSON.stringify(r.log))); // the log survives JSON, like a saved bug report
      if (stateDigest(again) !== stateDigest(r.end)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it("cover the paths that matter (games end, players lose, turns pass)", () => {
    const finished = results.filter((r) => r.end.over).length;
    const actions = results.reduce((n, r) => n + r.actions, 0);
    expect(finished).toBeGreaterThan(50);
    expect(actions).toBeGreaterThan(GAMES * 100);
    expect(results.some((r) => r.end.turn.number > 20)).toBe(true);
  });
});
