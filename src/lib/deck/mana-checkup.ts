// Mana base checkup (V3, Nov 15, 2026): a land count from the deck's curve and cheap ramp instead of a flat 37,
// lands that enter tapped, and ramp that one artifact wipe would take out. Pure functions; the Stats screen draws them.
import type { DeckLine } from "./model";

const faces = (s: string | null | undefined, sep: string) => (s ?? "").split(sep);
const frontIsLand = (l: DeckLine) => /\bLand\b/.test(faces(l.card.type_line, " // ")[0]);
const sumQ = (lines: DeckLine[]) => lines.reduce((n, l) => n + l.quantity, 0);

/**
 * Frank Karsten's land formula for a 99-card deck (ChannelFireball, "How Many Lands Do You Need in Your Deck? An
 * Updated Analysis"): 31.42 + 3.13 x average mana value of the nonland cards - 0.28 x cheap card draw or mana ramp
 * spells. "Cheap" there means mana value 2 or less. He calls it a back-of-the-envelope estimate.
 */
export const KARSTEN = { base: 31.42, perManaValue: 3.13, perCheap: 0.28, cheapMaxValue: 2 } as const;

/**
 * A modal double-faced card with a spell front and a land back counts as part of a land (Karsten). David's rule
 * (Nov 21, 2026): weigh it by how the land side enters, not by rarity. One that always enters tapped is 0.38 of a
 * land; one that can enter untapped (usually by paying 3 life, like the Zendikar Rising mythics) is 0.74.
 */
export const MDFC_WEIGHT = { tapped: 0.38, untapped: 0.74 } as const;

export type MdfcPart = { line: DeckLine; weight: number; /** null while its text is still loading (counted as tapped). */ untapped: boolean | null };

export type LandAdvice = {
  /** Rounded suggestion, kept between 30 and 45 so an odd deck can't produce a silly number. */
  recommended: number;
  /** The formula's unrounded result. */
  exact: number;
  /** Average mana value of the nonland cards (commander included; MDFCs with a land face count as spells). */
  average: number;
  /** Nonland cards the average is over, copies included. */
  spells: number;
  /** Cheap ramp and card draw: nonland, mana value 2 or less, fills Ramp or Card advantage. */
  cheap: number;
  /** Every card you can play as a land drop (MDFCs with a land face included), copies included. */
  lands: number;
  /** Lands with MDFCs counted as part-lands: what the suggestion is compared with. */
  effective: number;
  /** The spell-front MDFCs and the share of a land each counts as. */
  mdfcs: MdfcPart[];
};

/** A spell on the front, a land on the back. */
export const isSpellLand = (l: DeckLine) => !!l.card.counts_as_land && !frontIsLand(l);

/**
 * The 100-card deck's suggested land count. `isCheapHelper` says whether a card fills Ramp or Card advantage;
 * `textOf` gives a card's oracle text, to tell tapped MDFCs from untapped ones (unknown counts as tapped).
 */
export function landAdvice(
  lines: DeckLine[],
  isCheapHelper: (l: DeckLine) => boolean,
  textOf?: (oracleId: string) => string | null | undefined,
): LandAdvice {
  const spells = lines.filter((l) => !frontIsLand(l));
  const count = sumQ(spells);
  const average = count ? spells.reduce((n, l) => n + l.card.mana_value * l.quantity, 0) / count : 0;
  const cheap = sumQ(spells.filter((l) => l.card.mana_value <= KARSTEN.cheapMaxValue && isCheapHelper(l)));
  const exact = KARSTEN.base + KARSTEN.perManaValue * average - KARSTEN.perCheap * cheap;
  const mdfcs: MdfcPart[] = lines.filter(isSpellLand).map((line) => {
    const text = textOf?.(line.card.oracle_id);
    const untapped = text == null ? null : enteredTapped({ name: line.card.name, type_line: line.card.type_line, oracle_text: text }) !== "always";
    return { line, untapped, weight: untapped ? MDFC_WEIGHT.untapped : MDFC_WEIGHT.tapped };
  });
  const full = sumQ(lines.filter((l) => l.card.counts_as_land && !isSpellLand(l)));
  const effective = full + mdfcs.reduce((n, m) => n + m.weight * m.line.quantity, 0);
  return {
    recommended: Math.max(30, Math.min(45, Math.round(exact))),
    exact,
    average,
    spells: count,
    cheap,
    lands: sumQ(lines.filter((l) => l.card.counts_as_land)),
    effective,
    mdfcs,
  };
}

/** Effective lands minus the suggestion, rounded to the nearest land (halves away from zero). */
export const landGap = (a: LandAdvice) => {
  const d = a.effective - a.recommended;
  return Math.sign(d) * Math.round(Math.abs(d));
};

/** "35" or "35.4": lands with part-land MDFCs. */
export const landsText = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

/** Cheap ramp or draw spells that would make up `lands` lands in the formula (0.28 each). */
export const cheapForLands = (lands: number) => Math.max(0, Math.ceil(lands / KARSTEN.perCheap - 1e-9));

const choose = (n: number, k: number) => {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
};

/**
 * Chance to have drawn at least `need` lands by turn `turn` in a 99-card library: 7 cards plus one a turn, since
 * nobody skips the first draw in multiplayer (Comprehensive Rules 103.8c). Lands only, before any mulligan.
 */
export function landOdds(lands: number, need = 4, turn = 4, library = 99) {
  const seen = 7 + turn;
  const k = Math.max(0, Math.min(library, Math.round(lands)));
  let p = 0;
  for (let x = need; x <= Math.min(seen, k); x++) p += (choose(k, x) * choose(library - k, seen - x)) / choose(library, seen);
  return p;
}

export type Tapped = "always" | "sometimes" | "never";

/**
 * Whether a land enters tapped, from its oracle text. Reads only the land face of a double-faced card. "Sometimes"
 * is a condition in the same sentence: check lands ("unless you control a Plains"), shock lands ("If you don't, it
 * enters tapped"), fast and slow lands. Only the land itself counts, not "creatures your opponents control enter
 * tapped".
 */
export function enteredTapped(card: { name: string; type_line: string; oracle_text?: string | null }): Tapped {
  const types = faces(card.type_line, " // ");
  const texts = faces(card.oracle_text, "\n//\n");
  const names = faces(card.name, " // ");
  const i = Math.max(0, types.findIndex((t) => /\bLand\b/.test(t)));
  const text = texts[i] ?? texts[0] ?? "";
  const name = (names[i] ?? names[0] ?? "").trim();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const self = new RegExp(`\\b(this land|it|${esc || "this land"}) enters( the battlefield)? tapped`, "i");
  let found: Tapped = "never";
  for (const sentence of text.split(/(?<=\.)\s+|\n/)) {
    if (!self.test(sentence)) continue;
    // "As this land enters, you may pay 2 life. If you don't, it enters tapped." has its condition in "If".
    if (/\b(unless|if)\b/i.test(sentence)) found = found === "always" ? "always" : "sometimes";
    else found = "always";
  }
  return found;
}

export type TappedCount = { always: DeckLine[]; sometimes: DeckLine[] };

/** Lands by how they enter. `textOf` gives the oracle text (null while it is still loading). */
export function tappedLands(lines: DeckLine[], textOf: (oracleId: string) => string | null | undefined): TappedCount {
  const out: TappedCount = { always: [], sometimes: [] };
  for (const l of lines) {
    if (!l.card.counts_as_land) continue;
    const state = enteredTapped({ name: l.card.name, type_line: l.card.type_line, oracle_text: textOf(l.card.oracle_id) });
    if (state !== "never") out[state].push(l);
  }
  return out;
}

export type RampRisk = { ramp: number; artifacts: number; risky: boolean };

/**
 * Ramp that is mostly artifacts (mana rocks) falls to one artifact wipe. Warn when more than half of the nonland
 * ramp is artifacts and there are at least 4 ramp cards (fewer is too small to call).
 */
export function rampRisk(lines: DeckLine[], isRamp: (l: DeckLine) => boolean): RampRisk {
  const ramp = lines.filter((l) => !frontIsLand(l) && isRamp(l));
  const artifacts = ramp.filter((l) => /\bArtifact\b/.test(faces(l.card.type_line, " // ")[0]));
  const n = sumQ(ramp);
  const a = sumQ(artifacts);
  return { ramp: n, artifacts: a, risky: n >= 4 && a / n > 0.5 };
}

export const isArtifactRamp = (l: DeckLine) => !frontIsLand(l) && /\bArtifact\b/.test(faces(l.card.type_line, " // ")[0]);
