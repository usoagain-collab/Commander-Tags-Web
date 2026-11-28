// The action log: setup + every action in order. Replaying it gives the same game, event for event
// (engine-design.md section 1). Every log pins the engine version and the card-script manifest.

import { step } from "./engine";
import { createGame, type GameSetup } from "./setup";
import { ENGINE_VERSION } from "./version";
import type { Action, GameEvent, GameState, Seat } from "./types";

export type LoggedAction = { seat: Seat; action: Action };

export type GameLog = {
  engineVersion: string;
  setup: GameSetup;
  actions: LoggedAction[];
};

export function newLog(setup: GameSetup): GameLog {
  return { engineVersion: ENGINE_VERSION, setup, actions: [] };
}

/**
 * Replays a log. Refused actions are kept in a log on purpose (they change nothing), so replay skips them
 * the same way. Pass `onEvent` to receive the resolved event stream.
 */
export function replay(log: GameLog, onEvent?: (e: GameEvent) => void): GameState {
  if (log.engineVersion !== ENGINE_VERSION) throw new Error(`log is from engine ${log.engineVersion}, this is ${ENGINE_VERSION}`);
  const start = createGame(log.setup);
  start.events.forEach((e) => onEvent?.(e));
  let s = start.state;
  for (const { seat, action } of log.actions) {
    const r = step(s, seat, action);
    r.events.forEach((e) => onEvent?.(e));
    s = r.state;
  }
  return s;
}
