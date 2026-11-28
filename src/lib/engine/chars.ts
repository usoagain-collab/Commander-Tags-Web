// Derived characteristics, cached once per state (engine-design.md section 5).
// A new state is a new WeakMap key, so the cache can't go stale, and nothing is computed until read.
//
// PR 1 has no continuous effects, so an object's characteristics are its printed face (plus controller).
// PR 4c replaces the body of `computeChars` with the layer system (613) behind the same `chars` call;
// nothing else in the engine reads printed values directly.

import { printedFace } from "./cards";
import { manaValue } from "./mana";
import { pmapGet } from "./pmap";
import type { Characteristics, GameObject, GameState, ObjectId } from "./types";

const cache = new WeakMap<GameState, Map<ObjectId, Characteristics>>();

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0; // "*" counts 0 until its characteristic-defining ability exists
}

export function computeChars(obj: GameObject): Characteristics {
  const f = printedFace(obj);
  // 712.8e: a transformed permanent's mana value is its front face's.
  const costForValue = obj.def.layout === "transform" ? obj.def.faces[0].manaCost : f.manaCost;
  return {
    name: f.name,
    manaCost: f.manaCost,
    manaValue: obj.status.faceDown ? 0 : manaValue(costForValue),
    colors: f.colors,
    supertypes: f.supertypes,
    types: f.types,
    subtypes: f.subtypes,
    power: num(f.power),
    toughness: num(f.toughness),
    loyalty: num(f.loyalty),
    controller: obj.controller,
  };
}

/** The characteristics of object `id` in `state`. Throws for an id that isn't in the state. */
export function chars(state: GameState, id: ObjectId): Characteristics {
  let table = cache.get(state);
  if (!table) {
    table = new Map();
    cache.set(state, table);
  }
  const hit = table.get(id);
  if (hit) return hit;
  const obj = pmapGet(state.objects, id);
  if (!obj) throw new Error(`chars: no object ${id}`);
  const c = computeChars(obj);
  table.set(id, c);
  return c;
}

export function hasType(state: GameState, id: ObjectId, type: string): boolean {
  return chars(state, id).types.includes(type);
}
