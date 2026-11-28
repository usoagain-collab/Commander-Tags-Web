// A player that picks a random legal answer to whatever is pending. For tests and benchmarks: it drives
// thousands of games through every path the engine has. It has its own seeded generator, separate from
// the game's, so the game's randomness is untouched.

import { nextFloat, nextInt, type RngState } from "./rng";
import type { Action, GameState, Seat } from "./types";

export type RandomPick = { seat: Seat; action: Action; rng: RngState };

export function randomAction(s: GameState, rng0: RngState, opts: { concedeChance?: number } = {}): RandomPick | null {
  const d = s.pendingDecision;
  if (!d) return null;
  let rng = rng0;
  let f: number;
  [f, rng] = nextFloat(rng);
  if (f < (opts.concedeChance ?? 0)) return { seat: d.seat, action: { kind: "concede" }, rng };

  const pick = <T>(xs: T[]): T => {
    let i: number;
    [i, rng] = nextInt(rng, xs.length);
    return xs[i];
  };

  if (d.kind === "chooseObjects") {
    const pool = (d.candidates ?? []).slice();
    const chosen: number[] = [];
    while (chosen.length < (d.min ?? 0)) {
      const i = pool.indexOf(pick(pool));
      chosen.push(pool.splice(i, 1)[0]);
    }
    return { seat: d.seat, action: { kind: "answer", decision: d.id, choice: { objects: chosen } }, rng };
  }

  if (d.kind === "payCost") {
    [f, rng] = nextFloat(rng);
    // Mostly auto-pay; sometimes tap by hand first, pay from the pool (which can fail and roll back), or cancel.
    if (f < 0.6) return { seat: d.seat, action: { kind: "answer", decision: d.id, choice: { pay: "auto" } }, rng };
    if (f < 0.7) return { seat: d.seat, action: { kind: "answer", decision: d.id, choice: { pay: "pool" } }, rng };
    if (f < 0.75) return { seat: d.seat, action: { kind: "answer", decision: d.id, choice: { cancel: true } }, rng };
    const taps = d.options.filter((o) => o.kind === "activateMana");
    if (taps.length) return { seat: d.seat, action: pick(taps), rng };
    return { seat: d.seat, action: { kind: "answer", decision: d.id, choice: { pay: "auto" } }, rng };
  }

  // Priority: pass about half the time, otherwise any legal starting action.
  const nonPass = d.options.filter((o) => o.kind !== "pass");
  [f, rng] = nextFloat(rng);
  if (nonPass.length === 0 || f < 0.5) return { seat: d.seat, action: { kind: "pass" }, rng };
  return { seat: d.seat, action: pick(nonPass), rng };
}
