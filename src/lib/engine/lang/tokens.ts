// Tokens (111): built-in ones (Treasure) and the ones a script defines. A token is an object with a
// CardDef of layout "token" whose script holds its abilities, so it plays like any other permanent.

import { face } from "../cards";
import type { CardDef, Color } from "../types";
import { LANGUAGE_VERSION, type CardScript, type TokenScript } from "./script-types";

const COLOR: Record<string, Color> = { white: "W", blue: "U", black: "B", red: "R", green: "G", W: "W", U: "U", B: "B", R: "R", G: "G" };
const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** 111.10a: a Treasure is a colorless Treasure artifact with "{T}, Sacrifice this token: Add one mana of any color." */
export const TREASURE: TokenScript = {
  id: "Treasure",
  name: "Treasure",
  types: ["artifact"],
  subtypes: ["Treasure"],
  abilities: [{ kind: "mana", cost: ["tap", { sacrifice: { object: "self" } }], add: { anyColor: 1 } }],
};

export const BUILT_IN_TOKENS: Record<string, TokenScript> = { Treasure: TREASURE };

export function tokenDef(t: TokenScript): CardDef {
  const types = t.types.map(cap);
  const typeLine = [...(t.supertypes ?? []).map(cap), ...types].join(" ") + (t.subtypes?.length ? ` — ${t.subtypes.join(" ")}` : "");
  const script: CardScript = {
    schema: LANGUAGE_VERSION,
    oracleId: `token-${t.id}`,
    name: t.name,
    faces: [{ abilities: (t.abilities ?? []).map((a) => ("kind" in a ? a : { kind: "keyword", ...(a as object) }) as never) }],
  };
  return {
    oracleId: `token:${t.name}`,
    layout: "token",
    faces: [
      face({
        name: t.name,
        typeLine,
        power: t.pt ? String(t.pt[0]) : null,
        toughness: t.pt ? String(t.pt[1]) : null,
        colors: (t.colors ?? []).map((c) => COLOR[c]).filter(Boolean),
      }),
    ],
    script,
  };
}
