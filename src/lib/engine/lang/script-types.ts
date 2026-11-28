// Card language `dg-card/1` (docs/card-language.md): the shapes of a card script.
// A script is plain JSON. The schema check (`validate.ts`) runs before anything else reads a script, so the
// engine can trust these shapes. Steps and expressions are kept as loose records here on purpose: the
// registry in `blocks.ts` says which fields each block takes, and one table is easier to keep right than
// sixty hand-written types that say the same thing.

export const LANGUAGE_VERSION = "dg-card/1";
/** Language versions this engine can run (card-language.md, "Versioning"). */
export const SUPPORTED_LANGUAGES = [LANGUAGE_VERSION] as const;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export type AbilityKind =
  | "keyword"
  | "spell"
  | "activated"
  | "mana"
  | "triggered"
  | "static"
  | "replacement"
  | "cda"
  | "loyalty"
  | "cost";

/** One ability. Its fields depend on `kind`; `validate.ts` checks them. */
export type Ability = JsonObject & { kind: AbilityKind; id?: string };

/** One step of an effect: `{ <block>: <args> }`, or `{ if, then, else }`. */
export type Step = JsonObject;

export type FaceScript = { abilities: Ability[] };

/** A token this card makes that isn't a built-in one (Treasure is built in). */
export type TokenScript = {
  id: string;
  name: string;
  types: string[];
  subtypes?: string[];
  supertypes?: string[];
  colors?: string[];
  pt?: [number, number];
  abilities?: Ability[];
};

export type CardScript = {
  schema: string;
  oracleId: string;
  name: string;
  oracleHash?: string;
  faces: FaceScript[];
  tokens?: TokenScript[];
  notes?: string;
};

/** A reference to something an effect works on: an object (by id) or a player (by seat). */
export type Ref = { o: number } | { p: number };

/** A bound variable's value. Lists of refs are the usual case (targets, `as:` results). */
export type Val = number | boolean | string | Ref[] | Ref[][];
