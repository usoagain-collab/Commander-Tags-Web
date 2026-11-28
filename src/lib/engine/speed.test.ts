// PR 1 gate (Measure): replaying a 2,000-action game takes under 1 second. `npm run engine:bench` prints
// the same number on any machine; this test keeps the bar from slipping.
import { describe, expect, it } from "vitest";
import { stateDigest } from "./digest";
import { step } from "./engine";
import { newLog, replay } from "./log";
import { randomAction } from "./random-player";
import { seedRng } from "./rng";
import { createGame } from "./setup";
import { mixedDeck } from "./test-cards";

describe("speed", () => {
  it("replays a 2,000-action, 4-player, 99-card game in under 1 second", () => {
    const setup = { seed: 42, seats: [0, 1, 2, 3].map(() => ({ deck: mixedDeck(99) })) };
    const log = newLog(setup);
    let s = createGame(setup).state;
    let rng = seedRng(295);
    while (!s.over && log.actions.length < 2000) {
      const pick = randomAction(s, rng)!;
      rng = pick.rng;
      log.actions.push({ seat: pick.seat, action: pick.action });
      s = step(s, pick.seat, pick.action).state;
    }
    expect(log.actions.length).toBe(2000);
    const t = performance.now();
    const end = replay(log);
    const ms = performance.now() - t;
    expect(stateDigest(end)).toBe(stateDigest(s));
    expect(ms).toBeLessThan(1000);
  });
});
