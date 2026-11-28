// A player that picks a random legal answer to whatever is pending. For tests and benchmarks: it drives
// thousands of games through every path the engine has. It has its own seeded generator, separate from
// the game's, so the game's randomness is untouched.

import { nextFloat, nextInt, type RngState } from "./rng";
import type { Action, Choice, GameState, Seat } from "./types";

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
  const answer = (choice: Choice): RandomPick => ({ seat: d.seat, action: { kind: "answer", decision: d.id, choice }, rng });

  if (d.kind === "chooseObjects") {
    if (d.purpose === "crew" || d.purpose === "search") return answer(d.default ?? { objects: [] });
    const pool = (d.candidates ?? []).slice();
    const chosen: number[] = [];
    while (chosen.length < (d.min ?? 0)) {
      const i = pool.indexOf(pick(pool));
      chosen.push(pool.splice(i, 1)[0]);
    }
    return answer({ objects: chosen });
  }

  if (d.kind === "chooseTargets") {
    const pool = (d.refs ?? []).slice();
    const n = Math.max(d.min ?? 1, 1);
    const chosen = [];
    while (chosen.length < n && pool.length) chosen.push(pool.splice(pool.indexOf(pick(pool)), 1)[0]);
    return answer({ targets: chosen });
  }

  if (d.kind === "yesNo") {
    [f, rng] = nextFloat(rng);
    return answer({ yes: f < 0.5 });
  }

  if (d.kind === "payCost") {
    [f, rng] = nextFloat(rng);
    // Mostly auto-pay; sometimes tap by hand first, pay from the pool (which can fail and roll back), or cancel.
    if (f < 0.6) return answer({ pay: "auto" });
    if (f < 0.7) return answer({ pay: "pool" });
    if (f < 0.75) return answer({ cancel: true });
    const taps = d.options.filter((o) => o.kind === "activateMana");
    if (taps.length) return { seat: d.seat, action: pick(taps), rng };
    return answer({ pay: "auto" });
  }

  if (d.kind === "payOrNot") {
    [f, rng] = nextFloat(rng);
    return answer({ pay: f < 0.5 ? "auto" : "decline" });
  }

  if (d.kind !== "priority") return answer(d.default ?? { cancel: true });

  // Priority: pass about half the time, otherwise any legal starting action.
  const nonPass = d.options.filter((o) => o.kind !== "pass");
  [f, rng] = nextFloat(rng);
  if (nonPass.length === 0 || f < 0.5) return { seat: d.seat, action: { kind: "pass" }, rng };
  return { seat: d.seat, action: pick(nonPass), rng };
}
