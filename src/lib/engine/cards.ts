// Card objects know every face (engine-design.md section 2). Which face's printed facts apply depends on
// the layout and the zone; `printedFace` is the one place that decides.
//
// PR 1 makes normal, transform, modal DFC, adventure and split work; every other layout has the shape
// (its faces are stored) and reads as its front face until a top-500 card needs more.

import type { CardDef, Color, FaceDef, GameObject, Layout } from "./types";

const SUPERTYPES = new Set(["Basic", "Legendary", "Snow", "World", "Ongoing", "Elite", "Host"]);
const DASH = "—"; // Scryfall type lines separate subtypes with an em dash

/** How far each layout is built. "works" = played by the rules in PR 1; "shape" = stored, front face only. */
export const LAYOUT_SUPPORT: Record<Layout, "works" | "shape"> = {
  normal: "works",
  transform: "works",
  modal_dfc: "works",
  adventure: "works",
  split: "works",
  saga: "works", // a saga is a normal enchantment until chapter abilities (PR 2)
  token: "works",
  flip: "shape",
  room: "shape",
  meld: "shape",
  prototype: "shape",
  class: "shape",
  case: "shape",
  leveler: "shape",
  omen: "shape",
  emblem: "shape",
};

export function parseTypeLine(typeLine: string): Pick<FaceDef, "supertypes" | "types" | "subtypes"> {
  const [left, right = ""] = typeLine.split(DASH).map((s) => s.trim());
  const words = left.split(/\s+/).filter(Boolean);
  return {
    supertypes: words.filter((w) => SUPERTYPES.has(w)),
    types: words.filter((w) => !SUPERTYPES.has(w)),
    subtypes: right.split(/\s+/).filter(Boolean),
  };
}

/** Builds a FaceDef from the printed fields, filling the type lists from the type line. */
export function face(p: {
  name: string;
  typeLine: string;
  manaCost?: string | null;
  oracleText?: string;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  defense?: string | null;
  colors?: Color[];
}): FaceDef {
  return {
    name: p.name,
    manaCost: p.manaCost ?? null,
    typeLine: p.typeLine,
    ...parseTypeLine(p.typeLine),
    oracleText: p.oracleText ?? "",
    power: p.power ?? null,
    toughness: p.toughness ?? null,
    loyalty: p.loyalty ?? null,
    defense: p.defense ?? null,
    colors: p.colors ?? colorsOfCost(p.manaCost ?? null),
  };
}

export function colorsOfCost(cost: string | null): Color[] {
  if (!cost) return [];
  const out: Color[] = [];
  for (const c of ["W", "U", "B", "R", "G"] as Color[]) if (cost.includes(c)) out.push(c);
  return out;
}

export function isLandFace(f: FaceDef): boolean {
  return f.types.includes("Land");
}

/** Faces that can be cast as a spell from hand (before permissions like Muldrotha's). */
export function castableFaces(def: CardDef): number[] {
  switch (def.layout) {
    case "modal_dfc":
      return def.faces.map((f, i) => (isLandFace(f) ? -1 : i)).filter((i) => i >= 0);
    case "adventure":
    case "split":
      return def.faces.map((_, i) => i);
    default:
      return isLandFace(def.faces[0]) ? [] : [0];
  }
}

/** Faces that can be played as a land (116.2a): the front of a land, or a modal DFC's land face. */
export function playableLandFaces(def: CardDef): number[] {
  if (def.layout === "modal_dfc") return def.faces.map((f, i) => (isLandFace(f) ? i : -1)).filter((i) => i >= 0);
  return isLandFace(def.faces[0]) ? [0] : [];
}

/**
 * Which face's script applies right now: the same choice as `printedFace`. "all" for a split card off the
 * stack (709.4: both halves' text), -1 for a face-down object (no text, 708.2).
 */
export function printedFaceIndex(obj: GameObject): number | "all" {
  const { def, zone, status } = obj;
  if (status.faceDown) return -1;
  const onStackOrField = zone === "stack" || zone === "battlefield";
  switch (def.layout) {
    case "transform":
    case "modal_dfc":
      return onStackOrField ? status.upFace : 0;
    case "adventure":
      return zone === "stack" && obj.castInfo?.face === 1 ? 1 : 0;
    case "split":
      return zone === "stack" && obj.castInfo ? obj.castInfo.face : "all";
    default:
      return 0;
  }
}

/** Face-down objects are 2/2 with no name, text, cost or color (708.2). */
const FACE_DOWN: FaceDef = face({ name: "", typeLine: "Creature", power: "2", toughness: "2", colors: [] });

/** The printed face whose characteristics apply right now (712.8, 709.4, 715.3, 708). */
export function printedFace(obj: GameObject): FaceDef {
  const { def, zone, status } = obj;
  if (status.faceDown) return FACE_DOWN;
  const onStackOrField = zone === "stack" || zone === "battlefield";
  switch (def.layout) {
    case "transform":
    case "modal_dfc":
      // 712.8a: only the front face exists off the stack and battlefield.
      return onStackOrField ? def.faces[status.upFace] ?? def.faces[0] : def.faces[0];
    case "adventure":
      return zone === "stack" && obj.castInfo?.face === 1 ? def.faces[1] : def.faces[0];
    case "split":
      if (zone === "stack" && obj.castInfo) return def.faces[obj.castInfo.face];
      return combinedSplit(def.faces);
    default:
      return def.faces[0];
  }
}

/** 709.4: a split card off the stack has both halves' characteristics combined. */
function combinedSplit(faces: FaceDef[]): FaceDef {
  const uniq = <T>(xs: T[]) => [...new Set(xs)];
  return {
    ...faces[0],
    name: faces.map((f) => f.name).join(" // "),
    manaCost: faces.map((f) => f.manaCost ?? "").join(""),
    typeLine: faces.map((f) => f.typeLine).join(" // "),
    supertypes: uniq(faces.flatMap((f) => f.supertypes)),
    types: uniq(faces.flatMap((f) => f.types)),
    subtypes: uniq(faces.flatMap((f) => f.subtypes)),
    oracleText: faces.map((f) => f.oracleText).join("\n//\n"),
    colors: uniq(faces.flatMap((f) => f.colors)),
  };
}

export const PERMANENT_TYPES = ["Artifact", "Battle", "Creature", "Enchantment", "Land", "Planeswalker"];

export function isPermanentFace(f: FaceDef): boolean {
  return f.types.some((t) => PERMANENT_TYPES.includes(t));
}
