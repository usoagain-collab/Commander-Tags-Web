// What the engine promises after every action (engine-design.md section 11). Returns a list of problems;
// an empty list means the state is sound. The random-game tests call this after every step.

import { MANA_TYPES } from "./mana";
import { pmapForEach } from "./pmap";
import type { GameState, ObjectId, ZoneName } from "./types";

export function checkInvariants(s: GameState): string[] {
  const out: string[] = [];
  const seen = new Map<ObjectId, ZoneName>();
  const seatOf = new Map<ObjectId, number>();
  const note = (zone: ZoneName, ids: ObjectId[], seat = -1) => {
    for (const id of ids) {
      if (seen.has(id)) out.push(`object ${id} is in ${seen.get(id)} and ${zone}`);
      seen.set(id, zone);
      seatOf.set(id, seat);
    }
  };
  for (const seat of s.seatOrder) {
    note("library", s.zones.library[seat] ?? [], seat);
    note("hand", s.zones.hand[seat] ?? [], seat);
    note("graveyard", s.zones.graveyard[seat] ?? [], seat);
  }
  note("battlefield", s.zones.battlefield);
  note("stack", s.zones.stack);
  note("exile", s.zones.exile);
  note("command", s.zones.command);

  const stored = new Set<ObjectId>();
  pmapForEach(s.objects, (o, id) => {
    stored.add(id);
    if (o.id !== id) out.push(`object stored under ${id} has id ${o.id}`);
    const zone = seen.get(id);
    if (!zone) out.push(`object ${id} (${o.def.faces[0].name}) is in no zone`);
    else if (zone !== o.zone) out.push(`object ${id} says ${o.zone} but is listed in ${zone}`);
    if ((o.zone === "library" || o.zone === "hand" || o.zone === "graveyard") && seatOf.get(id) !== o.owner)
      out.push(`object ${id} is not in its owner's ${o.zone}`);
    if (id >= s.nextObjectId) out.push(`object ${id} is not below nextObjectId`);
  });
  if (stored.size !== s.objects.size) out.push(`object map size ${s.objects.size} but ${stored.size} entries`);
  for (const id of seen.keys()) if (!stored.has(id)) out.push(`zone lists object ${id} that doesn't exist`);

  for (const seat of s.seatOrder) {
    const p = s.seats[seat];
    if (!Number.isInteger(p.life)) out.push(`seat ${seat} life ${p.life} is not an integer`);
    for (const t of MANA_TYPES) if (!Number.isInteger(p.pool[t]) || p.pool[t] < 0) out.push(`seat ${seat} has ${p.pool[t]} ${t} mana`);
    if (p.lost && (s.zones.hand[seat].length || s.zones.library[seat].length)) out.push(`seat ${seat} lost but still has cards`);
  }

  if (s.over) {
    if (s.pendingDecision) out.push("the game is over but a decision is pending");
  } else {
    const d = s.pendingDecision;
    if (!d) out.push("no pending decision and the game isn't over");
    else {
      if (s.seats[d.seat]?.lost) out.push(`decision for seat ${d.seat}, who has left`);
      if (d.kind === "priority" && s.priority.seat !== d.seat) out.push(`priority decision for ${d.seat} but priority is with ${s.priority.seat}`);
      if (d.kind === "payCost" && !s.casting) out.push("payment asked with no spell being cast");
    }
    if (s.casting && s.pendingDecision?.kind !== "payCost") out.push("a spell is mid-cast but no payment is being asked");
  }
  return out;
}
