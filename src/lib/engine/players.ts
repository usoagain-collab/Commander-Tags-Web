// Players losing and leaving (104, 800.4a basic).

import { pmapDelete } from "./pmap";
import { living, obj, setSeat } from "./state";
import type { GameEvent, GameState, ObjectId, Seat } from "./types";

/**
 * Basic elimination for PR 1 (800.4a): the player loses and every object they own leaves the game.
 * Ending control effects and exiling objects they control but don't own come with PR 4c (no control
 * changes exist before layers).
 */
export function eliminate(s0: GameState, ev: GameEvent[], seat: Seat, reason: string): GameState {
  let s = setSeat(s0, seat, { lost: true, lossReason: reason, drewFromEmpty: false });
  ev.push({ type: "lose", seat, reason });
  const owned = (id: ObjectId) => obj(s0, id).owner === seat;
  const gone: ObjectId[] = [];
  const keep = (list: ObjectId[]) => list.filter((id) => (owned(id) ? (gone.push(id), false) : true));
  const z = s.zones;
  s = {
    ...s,
    zones: {
      library: { ...z.library, [seat]: [] },
      hand: { ...z.hand, [seat]: [] },
      graveyard: { ...z.graveyard, [seat]: [] },
      battlefield: keep(z.battlefield),
      stack: keep(z.stack),
      exile: keep(z.exile),
      command: keep(z.command),
    },
  };
  for (const id of [...z.library[seat], ...z.hand[seat], ...z.graveyard[seat]]) gone.push(id);
  let objects = s.objects;
  for (const id of gone) objects = pmapDelete(objects, id);
  s = { ...s, objects, priority: { ...s.priority, passedInRow: s.priority.passedInRow.filter((x) => x !== seat) } };
  if (s.casting?.seat === seat) s = { ...s, casting: null };
  if (s.resolving && s.pendingDecision?.seat === seat) s = { ...s, resolving: { ...s.resolving, waiting: null } };
  if (s.pendingDecision?.seat === seat) s = { ...s, pendingDecision: null };
  const left = living(s);
  if (left.length <= 1) {
    const winner = left[0] ?? null;
    ev.push({ type: "gameOver", winner });
    return { ...s, over: true, winner, pendingDecision: null, casting: null, resolving: null };
  }
  return s;
}

