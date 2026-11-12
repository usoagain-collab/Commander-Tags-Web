// The "Plays" line under a deck's name (v2, David, Nov 11, 2026). Automatic = the top 3 themes. The owner can
// pick up to 3 tags, write a short description and name the archetype (decks.plays, migration 0052).
// Picked tags also steer Suggest and the Smart Cutter: they always count as themes, at PLAYS_WEIGHT times their score.
import type { TagKey, ThemeTag } from "./themes";

export type Plays = {
  /** Theme keys (o:slug or a:slug), at most PLAYS_MAX_TAGS. Empty = the top themes. */
  tags: TagKey[];
  /** The owner's own words, at most PLAYS_MAX_TEXT characters. */
  text: string | null;
  /** A Smart Cutter archetype key. Null = automatic. */
  archetype: string | null;
};

export const PLAYS_MAX_TAGS = 3;
export const PLAYS_MAX_TEXT = 80;
/** Picked tags count this many times their score in Suggest and the Smart Cutter (David chose double). */
export const PLAYS_WEIGHT = 2;
export const NO_PLAYS: Plays = { tags: [], text: null, archetype: null };

const isKey = (x: unknown): x is TagKey => typeof x === "string" && /^[oa]:[a-z0-9][a-z0-9-]*$/.test(x);

/** Reads decks.plays, dropping anything malformed. */
export function readPlays(raw: unknown): Plays {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NO_PLAYS;
  const r = raw as Record<string, unknown>;
  const tags = Array.isArray(r.tags) ? [...new Set(r.tags.filter(isKey))].slice(0, PLAYS_MAX_TAGS) : [];
  const text = typeof r.text === "string" ? cleanText(r.text) : null;
  const archetype = typeof r.archetype === "string" && /^[\w-]{1,60}$/.test(r.archetype) ? r.archetype : null;
  return { tags, text, archetype };
}

/** Trims, joins whitespace, caps the length. Empty becomes null. */
export function cleanText(text: string): string | null {
  const t = text.replace(/\s+/g, " ").trim().slice(0, PLAYS_MAX_TEXT).trim();
  return t || null;
}

export const isAutomatic = (p: Plays) => !p.tags.length && !p.text && !p.archetype;

/** What decks.plays stores: null when everything is automatic. */
export const playsToSave = (p: Plays) => (isAutomatic(p) ? null : { tags: p.tags, text: p.text, archetype: p.archetype });

/**
 * The tags the line shows: the picked ones in their order (labels from the deck's themes when they're there,
 * otherwise `labelOf`), else the top `n` automatic themes.
 */
export function playsTags(plays: Plays, themes: ThemeTag[], labelOf: (key: TagKey) => string, n = 3): { key: TagKey; label: string }[] {
  if (!plays.tags.length) return themes.slice(0, n).map((t) => ({ key: t.key, label: t.label }));
  const byKey = new Map(themes.map((t) => [t.key, t]));
  return plays.tags.map((key) => ({ key, label: byKey.get(key)?.label ?? labelOf(key) }));
}

/**
 * The themes Suggest and the Smart Cutter score against, steered by the picked tags. `top` is the usual list
 * (top 15); `all` is the deck's themes with no limit, same settings. Each picked tag found in `all` joins `top`
 * if it isn't there, and every picked tag counts `weight` times its score. Tags that aren't themes of the deck
 * (on one card only, a role tag) can't steer anything and are left out.
 */
export function steerThemes(top: ThemeTag[], all: ThemeTag[], picked: TagKey[], weight = PLAYS_WEIGHT): ThemeTag[] {
  if (!picked.length) return top;
  const want = new Set(picked);
  const inTop = new Set(top.map((t) => t.key));
  const extra = all.filter((t) => want.has(t.key) && !inTop.has(t.key));
  return [...top, ...extra].map((t) => (want.has(t.key) ? { ...t, score: t.score * weight } : t));
}
