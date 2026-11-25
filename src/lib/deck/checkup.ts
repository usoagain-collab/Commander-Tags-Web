// Deck Sequencer checkups (Nov 21, 2026): quick checks on how the deck is built, from deck-building advice David
// shared (Deck Driver MTG's five tips). Each one is pure and works on plain card facts, so the Sequencer screen
// and the tests can feed it the same way. The land count has its own module (mana-checkup.ts).

export type CheckCard = {
  oracle_id: string;
  name: string;
  quantity: number;
  mana_value: number;
  /** Not a land on its front face (MDFCs with a spell front count as spells). */
  spell: boolean;
  commander: boolean;
  /** Role keys it fills, Lands left out. */
  roles: string[];
  /** Theme tags of the deck it carries. */
  themes: number;
  /** Cheated into play by the deck (reanimate, sneak), so its cost doesn't weigh on the curve. */
  cheat: boolean;
};

export const CHECKUP = {
  /** Average mana value over this is flagged (same line as the Stats health score). */
  curveIdeal: 3.2,
  /** Spells at this mana value or more are "heavy". */
  heavyFrom: 6,
  /** More heavy spells than this is flagged. */
  heavyMax: 8,
  /** Share of spells at mana value 3 or less that counts as a low curve. */
  lowShare: 0.6,
  /** Ramp and card advantage are uneven when the smaller is under this share of the larger. */
  balanceShare: 0.6,
  /** Below this many of the larger, the split is too small to call. */
  balanceMin: 6,
  /** Share of spells that fill two or more roles before overlap counts as good. */
  overlapShare: 0.2,
} as const;

const sumQ = (cs: CheckCard[]) => cs.reduce((n, c) => n + c.quantity, 0);
const spellsOf = (cs: CheckCard[]) => cs.filter((c) => c.spell);

export type CurveCheck = {
  average: number;
  /** Mana value 3 or less, copies included. */
  low: number;
  spells: number;
  /** Heavy spells you cast yourself (cheat targets left out), most expensive first. */
  heavy: CheckCard[];
  ok: boolean;
};

/** Tip 1, lower your curve: the average, how much sits at 1-3 mana, and the heavy spells you'd hard-cast. */
export function curveCheck(cards: CheckCard[]): CurveCheck {
  const spells = spellsOf(cards);
  const count = sumQ(spells);
  const average = count ? spells.reduce((n, c) => n + c.mana_value * c.quantity, 0) / count : 0;
  const low = sumQ(spells.filter((c) => c.mana_value <= 3));
  const heavy = spells.filter((c) => c.mana_value >= CHECKUP.heavyFrom && !c.cheat && !c.commander).sort((a, b) => b.mana_value - a.mana_value || a.name.localeCompare(b.name));
  const ok = average <= CHECKUP.curveIdeal && sumQ(heavy) <= CHECKUP.heavyMax;
  return { average, low, spells: count, heavy, ok };
}

export type BalanceCheck = { ramp: number; draw: number; even: boolean; /** The side that's short, when uneven. */ short: "ramp" | "draw" | null };

/** Tip 4, an even split of mana and cards: ramp and card advantage counts side by side. */
export function balanceCheck(cards: CheckCard[]): BalanceCheck {
  const ramp = sumQ(cards.filter((c) => c.roles.includes("ramp")));
  const draw = sumQ(cards.filter((c) => c.roles.includes("draw")));
  const big = Math.max(ramp, draw);
  const even = big < CHECKUP.balanceMin || Math.min(ramp, draw) >= CHECKUP.balanceShare * big;
  return { ramp, draw, even, short: even ? null : ramp < draw ? "ramp" : "draw" };
}

export type OverlapCheck = { multi: CheckCard[]; spells: number; share: number; ok: boolean };

/** Tip 3, overlap your categories: spells that fill two or more roles are rarely dead draws. */
export function overlapCheck(cards: CheckCard[]): OverlapCheck {
  const spells = spellsOf(cards).filter((c) => !c.commander);
  const multi = spells.filter((c) => new Set(c.roles).size >= 2).sort((a, b) => b.roles.length - a.roles.length || a.name.localeCompare(b.name));
  const count = sumQ(spells);
  const share = count ? sumQ(multi) / count : 0;
  return { multi, spells: count, share, ok: share >= CHECKUP.overlapShare };
}

/** Tip 5, follow your game plan: spells that fill no role and share no theme with the deck. */
export function offPlan(cards: CheckCard[]): CheckCard[] {
  return spellsOf(cards)
    .filter((c) => !c.commander && !c.roles.length && c.themes === 0)
    .sort((a, b) => b.mana_value - a.mana_value || a.name.localeCompare(b.name));
}
