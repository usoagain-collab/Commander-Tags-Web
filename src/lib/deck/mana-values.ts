// Change mana cost (v2): per deck, a card can count at another mana value for stats (decks.mana_values,
// oracle id -> 0..20). Applied to the card details the deck's lines are built from, so the curve, average,
// Group and Sort by mana value, opening hands and the Smart Cutter all follow it without changes of their own.
import type { CardSummary } from "./model";

export const MAX_MANA_VALUE = 20;
export type ManaValues = Record<string, number>;

export function readManaValues(saved: unknown): ManaValues {
  const out: ManaValues = {};
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    for (const [k, v] of Object.entries(saved)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = Math.max(0, Math.min(MAX_MANA_VALUE, Math.round(n)));
    }
  }
  return out;
}

/** The deck's cards with their counted mana value; the same object back when nothing is overridden. */
export function applyManaValues(cards: Record<string, CardSummary>, values: ManaValues): Record<string, CardSummary> {
  const keys = Object.keys(values).filter((k) => cards[k] && cards[k].mana_value !== values[k]);
  if (keys.length === 0) return cards;
  const out = { ...cards };
  for (const k of keys) out[k] = { ...cards[k], mana_value: values[k] };
  return out;
}

/** Sets or clears (null, or the card's own value) one override. */
export function withManaValue(values: ManaValues, oracleId: string, value: number | null, own: number): ManaValues {
  const next = { ...values };
  if (value === null || value === own) delete next[oracleId];
  else next[oracleId] = Math.max(0, Math.min(MAX_MANA_VALUE, Math.round(value)));
  return next;
}
