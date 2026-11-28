// PR 1 speed proof: replay a 2,000-action game from its log and time it.
// Usage: npm run engine:bench [-- --games 1000]
import { createGame, step, replay, newLog, checkInvariants, stateDigest } from "@/lib/engine";
import { randomAction } from "@/lib/engine/random-player";
import { mixedDeck } from "@/lib/engine/test-cards";
import { seedRng } from "@/lib/engine/rng";

const ACTIONS = 2000;

function play(seed: number) {
  const setup = { seed, seats: [0, 1, 2, 3].map(() => ({ deck: mixedDeck(99) })) };
  const log = newLog(setup);
  let s = createGame(setup).state;
  let rng = seedRng(seed * 7 + 1);
  while (!s.over && log.actions.length < ACTIONS) {
    const pick = randomAction(s, rng)!;
    rng = pick.rng;
    log.actions.push({ seat: pick.seat, action: pick.action });
    s = step(s, pick.seat, pick.action).state;
  }
  return { log, s };
}

const { log, s } = play(42);
const problems = checkInvariants(s);
const runs: number[] = [];
let last = "";
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  const end = replay(log);
  runs.push(performance.now() - t);
  last = stateDigest(end);
}
const best = Math.min(...runs);
console.log(`Replayed a ${log.actions.length}-action 4-player game (turn ${s.turn.number}${s.over ? ", game over" : ""}).`);
console.log(`Times (ms): ${runs.map((r) => r.toFixed(0)).join(", ")}. Best ${best.toFixed(0)} ms. Bar: under 1,000 ms.`);
console.log(`Same end state as the live game: ${last === stateDigest(s) ? "yes" : "NO"}. Invariant problems: ${problems.length}.`);
console.log(best < 1000 && last === stateDigest(s) ? "PASS" : "FAIL");
