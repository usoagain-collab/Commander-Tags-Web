// Smart Cutter saved settings, read defensively (they're JSON from the database, migration 0031):
// decks.cutter (per deck) and profiles.cutter_prefs (per user).
import type { ArchetypeAnswer } from "./archetype";
import type { Archetype, Curve, Signal } from "./archetypes";
import { DEFAULT_WEIGHTS, type CutterWeights } from "./config";

export type CutterState = {
  /** Pet cards: never suggested. */
  locks: string[];
  /** Dismissed suggestions: oracle_id -> reason ("" in default mode). */
  dismissed: Record<string, string>;
  archetype: ArchetypeAnswer;
  /** Power user: count on the curve, or always a cheat target. */
  curve: Record<string, "curve" | "cheat">;
  /** Head to head results, newest last: [winner, loser]. */
  h2h: [string, string][];
};

export type CutterPrefs = {
  power: boolean;
  weights: CutterWeights;
  comboProtect: boolean;
  belowTargetWarning: boolean;
  cutsToMaybe: boolean;
  archetypes: Archetype[];
};

export const H2H_LIMIT = 300;
export const DISMISS_REASONS = ["combo piece", "pet card", "meta call", "other"] as const;

export const DEFAULT_STATE: CutterState = { locks: [], dismissed: {}, archetype: { key: null, status: "auto", rejected: [] }, curve: {}, h2h: [] };
export const DEFAULT_PREFS: CutterPrefs = {
  power: false,
  weights: DEFAULT_WEIGHTS,
  comboProtect: true,
  belowTargetWarning: true,
  cutsToMaybe: false,
  archetypes: [],
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strings = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function readCutterState(saved: unknown): CutterState {
  const s = obj(saved);
  const a = obj(s.archetype);
  const status = a.status === "confirmed" || a.status === "picked" ? a.status : "auto";
  const dismissed: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(s.dismissed))) dismissed[k] = typeof v === "string" ? v : "";
  const curve: Record<string, "curve" | "cheat"> = {};
  for (const [k, v] of Object.entries(obj(s.curve))) if (v === "curve" || v === "cheat") curve[k] = v;
  const h2h = (Array.isArray(s.h2h) ? s.h2h : [])
    .filter((p): p is [string, string] => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string")
    .slice(-H2H_LIMIT);
  return {
    locks: strings(s.locks),
    dismissed,
    archetype: { key: typeof a.key === "string" ? a.key : null, status, rejected: strings(a.rejected) },
    curve,
    h2h,
  };
}

function readCurve(v: unknown): Curve | null {
  if (!Array.isArray(v) || v.length !== 7 || !v.every((n) => typeof n === "number" && n >= 0)) return null;
  const sum = v.reduce((a, b) => a + b, 0);
  return sum > 0 ? (v.map((n) => (100 * n) / sum) as Curve) : null;
}

function readSignal(v: unknown): Signal | null {
  const s = obj(v);
  const weight = num(s.weight, 0, 10, 1);
  const full = typeof s.full === "number" && s.full > 0 ? s.full : undefined;
  const from = typeof s.from === "number" && s.from >= 0 && s.from < (full ?? 0.2) ? s.from : undefined;
  if (s.kind === "tags" && strings(s.slugs).length) return { kind: "tags", slugs: strings(s.slugs), weight, full, from };
  if (s.kind === "type" && typeof s.type === "string" && s.type) return { kind: "type", type: s.type, weight, full, from };
  if (s.kind === "role" && typeof s.role === "string" && s.role) return { kind: "role", role: s.role, weight, full, from };
  if (s.kind === "fact" && ["instantsSorceries", "bigSpells", "combos", "typal"].includes(s.fact as string))
    return { kind: "fact", fact: s.fact as "instantsSorceries", weight, full, from };
  return null;
}

export function readCutterPrefs(saved: unknown): CutterPrefs {
  const p = obj(saved);
  const w = obj(p.weights);
  const weights: CutterWeights = {
    coverage: num(w.coverage, 0, 1, DEFAULT_WEIGHTS.coverage),
    saturation: num(w.saturation, 0, 1, DEFAULT_WEIGHTS.saturation),
    weakest: num(w.weakest, 0, 1, DEFAULT_WEIGHTS.weakest),
    theme: num(w.theme, 0, 1, DEFAULT_WEIGHTS.theme),
    curve: num(w.curve, 0, 1, DEFAULT_WEIGHTS.curve),
    popularity: num(w.popularity, 0, 1, DEFAULT_WEIGHTS.popularity),
  };
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const archetypes = (Array.isArray(p.archetypes) ? p.archetypes : []).flatMap((a): Archetype[] => {
    const o = obj(a);
    const curve = readCurve(o.curve);
    if (typeof o.key !== "string" || !o.key || typeof o.name !== "string" || !o.name.trim() || !curve) return [];
    const signals = (Array.isArray(o.signals) ? o.signals : []).map(readSignal).filter((s): s is Signal => !!s);
    return [{ key: `custom:${o.key.replace(/^custom:/, "")}`, name: o.name.trim().slice(0, 40), signals, curve, custom: true }];
  });
  return {
    power: bool(p.power, false),
    weights: sum > 0 ? weights : DEFAULT_WEIGHTS,
    comboProtect: bool(p.comboProtect, true),
    belowTargetWarning: bool(p.belowTargetWarning, true),
    cutsToMaybe: bool(p.cutsToMaybe, false),
    archetypes,
  };
}
