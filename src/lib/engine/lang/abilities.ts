// Which abilities an object has, read from its card script (docs/card-language.md, "Abilities").
// Until the layer system (PR 4c) an object's abilities are its printed ones: the script of the face whose
// printed characteristics apply (cards.ts `printedFaceIndex`). Keywords that are activated abilities in the
// rules (cycling 702.29, equip 702.6, crew 702.122) become activated abilities here.

import { printedFaceIndex } from "../cards";
import { intrinsicMana, bundleOf, COLORS } from "../mana";
import type { GameObject, KeywordAbility, ManaType } from "../types";
import type { Ability, Json, JsonObject, Step } from "./script-types";

export type ScriptAbility = { ability: Ability; face: number; index: number };

/** The printed abilities of the face that counts right now (both halves for a split card off the stack). */
export function printedAbilities(o: GameObject): ScriptAbility[] {
  const script = o.def.script;
  if (!script || o.status.faceDown) return [];
  const idx = printedFaceIndex(o);
  const faces = idx === "all" ? script.faces.map((_, i) => i) : [idx];
  return faces.flatMap((face) => (script.faces[face]?.abilities ?? []).map((ability, index) => ({ ability, face, index })));
}

export function keywordsOf(o: GameObject): KeywordAbility[] {
  return printedAbilities(o)
    .filter((a) => a.ability.kind === "keyword")
    .map((a) => a.ability as unknown as KeywordAbility);
}

export function abilityAt(o: GameObject, face: number, index: number): Ability | undefined {
  return o.def.script?.faces[face]?.abilities[index];
}

// ---------------------------------------------------------------- costs

export type CostPart =
  | { mana: string }
  | { tap: true }
  | { untap: true }
  | { payLife: Json }
  | { sacrifice: JsonObject }
  | { discard: JsonObject }
  | { exile: JsonObject }
  | { removeCounters: JsonObject }
  | { tapCreatures: JsonObject };

/** A cost as written in a script, as a list of parts. "{1}{T}" is { mana: "{1}" } and { tap }. */
export function costParts(cost: Json | undefined): CostPart[] {
  if (cost === undefined || cost === null || cost === "") return [];
  if (Array.isArray(cost)) return cost.flatMap((c) => costParts(c));
  if (typeof cost === "string") {
    if (cost === "tap") return [{ tap: true }];
    if (cost === "untap") return [{ untap: true }];
    const out: CostPart[] = [];
    if (cost.includes("{T}")) out.push({ tap: true });
    if (cost.includes("{Q}")) out.push({ untap: true });
    const mana = cost.replace(/\{[TQ]\}/g, "");
    if (mana) out.unshift({ mana });
    return out;
  }
  if (typeof cost === "object") {
    const [k] = Object.keys(cost);
    const v = (cost as JsonObject)[k];
    if (k === "life") return [{ payLife: v }];
    return [{ [k]: v } as CostPart];
  }
  return [];
}

export const manaPart = (parts: CostPart[]): string => parts.map((p) => ("mana" in p ? p.mana : "")).join("");

// ---------------------------------------------------------------- mana abilities

/** One mana ability an object has: intrinsic from a basic land type (305.6) or from its script (605). */
export type ManaAbility = { index: number; parts: CostPart[]; options: ManaType[][]; fromScript: boolean };

export function manaAbilitiesOf(o: GameObject, subtypes: string[]): ManaAbility[] {
  const out: ManaAbility[] = intrinsicMana(subtypes).map((m, index) => ({ index, parts: [{ tap: true }], options: [[m]], fromScript: false }));
  for (const a of printedAbilities(o)) {
    if (a.ability.kind !== "mana") continue;
    out.push({ index: out.length, parts: costParts(a.ability.cost), options: manaOptions(a.ability.add), fromScript: true });
  }
  return out;
}

function manaOptions(add: Json | undefined): ManaType[][] {
  if (typeof add === "string") return [bundleOf(add)];
  if (add && typeof add === "object" && !Array.isArray(add)) {
    if ("anyColor" in add) {
      const n = typeof add.anyColor === "number" ? add.anyColor : 1;
      return COLORS.map((c) => Array<ManaType>(n).fill(c));
    }
    if (Array.isArray(add.oneOf)) {
      const n = typeof add.amount === "number" ? add.amount : 1;
      return (add.oneOf as string[]).map((c) => Array<ManaType>(n).fill(c as ManaType));
    }
  }
  return [];
}

// ---------------------------------------------------------------- activated abilities

/** An activated ability ready to use: its zone, cost, targets, effect and timing. */
export type Activatable = {
  face: number;
  index: number;
  kind: "activated" | "loyalty";
  zone: "battlefield" | "hand" | "graveyard";
  parts: CostPart[];
  loyalty?: number;
  targets?: Json;
  effect: Step[];
  sorcery: boolean;
  oncePerTurn: boolean;
  from: string; // "activated", "loyalty", or the keyword that made it
};

export function activatedAbilitiesOf(o: GameObject): Activatable[] {
  return printedAbilities(o).flatMap(({ ability, face, index }) => {
    const a = toActivatable(ability, face, index);
    return a ? [a] : [];
  });
}

/** The activated ability at a face and index of a card's script (an ability on the stack finds its effect here). */
export function activatableAt(def: GameObject["def"], face: number, index: number): Activatable | null {
  const a = def.script?.faces[face]?.abilities[index];
  return a ? toActivatable(a, face, index) : null;
}

function toActivatable(a: Ability, face: number, index: number): Activatable | null {
  const base = { face, index };
  if (a.kind === "activated") {
    return {
      ...base,
      kind: "activated",
      zone: (a.zone as Activatable["zone"]) ?? "battlefield",
      parts: costParts(a.cost),
      targets: a.targets,
      effect: (a.effect as Step[]) ?? [],
      sorcery: a.timing === "sorcery",
      oncePerTurn: a.limit === "oncePerTurn",
      from: "activated",
    };
  } else if (a.kind === "loyalty") {
    // 606.3: sorcery timing, once per turn per planeswalker; the loyalty cost is part of the cost.
    return { ...base, kind: "loyalty", zone: "battlefield", parts: [], loyalty: a.loyalty as number, targets: a.targets, effect: (a.effect as Step[]) ?? [], sorcery: true, oncePerTurn: false, from: "loyalty" };
  } else if (a.kind === "keyword") {
    const k = a.keyword;
    if (k === "cycling") {
      // 702.29a: "[Cost], Discard this card: Draw a card." Typecycling searches instead (702.29e).
      const effect: Step[] = a.search
        ? [
            { search: { player: "you", select: a.search, max: 1, reveal: true, as: "found" } },
            { move: { objects: "$found", to: "hand" } },
            { shuffle: { player: "you" } },
          ]
        : [{ draw: 1 }];
      return { ...base, kind: "activated", zone: "hand", parts: [...costParts(a.cost), { discard: { object: "self" } }], effect, sorcery: false, oncePerTurn: false, from: "cycling" };
    } else if (k === "equip") {
      // 702.6a: "[Cost]: Attach to target creature you control. Equip only as a sorcery."
      return {
        ...base,
        kind: "activated",
        zone: "battlefield",
        parts: costParts(a.cost),
        targets: [{ id: "equipTarget", select: { type: "creature", controller: "you", other: true } }],
        effect: [{ attach: { object: "self", to: "$equipTarget" } }],
        sorcery: true,
        oncePerTurn: false,
        from: "equip",
      };
    } else if (k === "crew") {
      // 702.122a: "Tap any number of untapped creatures you control with total power N or more: This Vehicle
      // becomes an artifact creature until end of turn." The cost runs now; the type change is layer 4 (PR 4c).
      return {
        ...base,
        kind: "activated",
        zone: "battlefield",
        parts: [{ tapCreatures: { power: a.amount as Json } }],
        effect: [{ continuous: { layer: "4", affects: "self", do: { addTypes: ["artifact", "creature"] }, duration: "endOfTurn" } }],
        sorcery: false,
        oncePerTurn: false,
        from: "crew",
      };
    }
  }
  return null;
}

/** The face's spell ability (608): what an instant or sorcery does, or a permanent spell's targets (Auras). */
export function spellAbility(o: GameObject, face: number): Ability | undefined {
  return o.def.script?.faces[face]?.abilities.find((a) => a.kind === "spell");
}

export function faceKeyword(o: GameObject, face: number, name: string): (Ability & { keyword: string }) | undefined {
  return o.def.script?.faces[face]?.abilities.find((a) => a.kind === "keyword" && a.keyword === name) as (Ability & { keyword: string }) | undefined;
}

export function costAbilities(o: GameObject, face: number): Ability[] {
  return o.def.script?.faces[face]?.abilities.filter((a) => a.kind === "cost") ?? [];
}

/** "This spell can't be countered": a static the engine reads straight from the spell's own printed text. */
export function cantBeCountered(o: GameObject): boolean {
  return printedAbilities(o).some(
    (a) =>
      a.ability.kind === "static" &&
      Array.isArray(a.ability.effects) &&
      (a.ability.effects as JsonObject[]).some((e) => !!e && typeof e === "object" && (e.ruleEffect as JsonObject | undefined)?.cantBeCountered === true),
  );
}
