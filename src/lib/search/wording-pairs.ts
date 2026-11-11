// Wording matches for Suggest (v2, Nov 10, 2026; DefCat lesson 3). Two kinds of phrases:
//  - the commander's own wording (wordingPhrases): cards that say the same thing;
//  - mirror phrases from MIRRORS: when the commander's text says X, cards that CAUSE X. Landfall wants cards that
//    make lands enter, not only more landfall cards. This list is a draft for David to review: every phrase is plain
//    rules text in lower case, as Scryfall writes it today ("enters", not "enters the battlefield"), matched inside
//    cards.oracle_norm by SQL cards_with_wording (migration 0048).
import { normalizeOracle, wordingPhrases, wordingQuery } from "./wording";

export type Mirror = {
  /** Tested against the commander's normalized rules text (lower case, own name as ~). */
  when: RegExp;
  /** Phrases a card that feeds it would say. */
  also: string[];
  /** Short name for its button in Angles ("Land types"). */
  name: string;
  /** Why a card saying one of them helps, after "Feeds your commander: ". */
  why: string;
};

export const MIRRORS: Mirror[] = [
  {
    when: /whenever (a|one or more) lands? you control enters|landfall/,
    also: ["return a land you control to its owner's hand", "you may play an additional land", "put a land card from your hand onto the battlefield", "play lands from your graveyard", "search your library for a basic land card, put it onto the battlefield"],
    name: "Extra lands",
    why: "makes lands enter",
  },
  {
    when: /whenever (a|another|one or more) (nontoken )?creatures?( you control)? dies?/,
    also: ["sacrifice a creature", "sacrifice another creature", "destroy all creatures", "each player sacrifices a creature"],
    name: "Creatures dying",
    why: "makes creatures die",
  },
  {
    when: /whenever (a|another|one or more) (nontoken )?creatures?( you control)? enters|when ~ enters/,
    also: ["exile target creature you control, then return", "return it to the battlefield", "return those cards to the battlefield", "create a token that's a copy of"],
    name: "Blink and copies",
    why: "makes creatures enter again",
  },
  {
    when: /whenever you discard|whenever a player discards/,
    also: ["discard a card", "discard your hand", "draw two cards, then discard", "each player discards"],
    name: "Discard",
    why: "makes you discard",
  },
  {
    when: /whenever you gain life/,
    also: ["you gain 1 life", "each opponent loses 1 life and you gain", "gain life equal to"],
    name: "Repeat life gain",
    why: "gains life again and again",
  },
  {
    when: /whenever you sacrifice|sacrifice (a|another) (creature|permanent|artifact)/,
    also: ["create a 1/1", "create two 1/1", "return target creature card from your graveyard to the battlefield"],
    name: "Sacrifice fodder",
    why: "gives you things to sacrifice",
  },
  {
    when: /\+1\/\+1 counters?|whenever one or more counters/,
    also: ["proliferate", "double the number of", "that many plus one", "with an additional +1/+1 counter"],
    name: "More counters",
    why: "multiplies counters",
  },
  {
    // Not everything counters (David, Nov 10, 2026): a second one does nothing for Omo.
    when: /loyalty counter|charge counter|oil counter|experience counter/,
    also: ["proliferate"],
    name: "Proliferate",
    why: "adds more counters",
  },
  {
    when: /create [^.]*tokens?|whenever (a|one or more) [^.]*tokens? /,
    also: ["populate", "twice that many", "create that many", "create a token that's a copy of"],
    name: "More tokens",
    why: "makes more tokens",
  },
  {
    when: /whenever you cast an instant or sorcery|whenever you cast a noncreature spell|whenever you cast your second spell/,
    also: ["copy target instant or sorcery spell", "costs {1} less to cast", "flashback"],
    name: "Cheap spells",
    why: "casts more spells for less",
  },
  {
    when: /whenever ~ attacks|whenever you attack|whenever (a|one or more) creatures? you control attacks?/,
    also: ["additional combat phase", "untap all creatures you control", "can't be blocked"],
    name: "Extra attacks",
    why: "attacks more often",
  },
  {
    when: /whenever ~ deals combat damage to a player|whenever (a|one or more) creatures? you control deals? combat damage to a player/,
    also: ["can't be blocked", "gains double strike", "has double strike"],
    name: "Evasion",
    why: "gets damage through",
  },
  {
    when: /whenever you draw|whenever a player draws|whenever an opponent draws/,
    also: ["each player draws", "target player draws", "draw two cards", "draws a card for each"],
    name: "Card draw for all",
    why: "makes cards get drawn",
  },
  {
    when: /from your graveyard|cards? in your graveyard/,
    also: ["mill three cards", "mill four cards", "surveil 2", "put the top three cards of your library into your graveyard"],
    name: "Fill the graveyard",
    why: "fills your graveyard",
  },
  {
    when: /whenever an artifact( you control)? enters|whenever one or more artifacts/,
    also: ["create a treasure token", "create a clue token", "investigate", "create a food token"],
    name: "Artifact tokens",
    why: "makes artifacts enter",
  },
  {
    when: /whenever an enchantment( you control)? enters|constellation/,
    also: ["enchantment creature token", "return target enchantment card from your graveyard"],
    name: "Enchantments entering",
    why: "makes enchantments enter",
  },
  {
    when: /leaves the battlefield|whenever ~ is put into a graveyard/,
    also: ["exile target creature you control, then return", "return target creature you control to its owner's hand"],
    name: "Leave and return",
    why: "makes it leave and come back",
  },
  {
    when: /\bmill\b|whenever one or more cards are put into your graveyard from your library/,
    also: ["mill three cards", "each player mills", "target player mills"],
    name: "Mill",
    why: "mills more",
  },
  {
    when: /whenever ~ becomes tapped|whenever you tap|untap target/,
    also: ["untap target permanent", "untap another target"],
    name: "Untap effects",
    why: "untaps permanents",
  },
  {
    when: /\bscry\b|\bsurveil\b|whenever you scry/,
    also: ["scry 1", "scry 2", "surveil 1", "surveil 2"],
    name: "Scry and surveil",
    why: "scries or surveils",
  },
  // Omo (David, Nov 10, 2026): lands that are every land type turn on every card that counts Gates, Urza lands,
  // Lairs, Loci, Deserts, Caves or basic land types. "gate" alone would also match investigate and propagate.
  {
    when: /every land type|all basic land types|every basic land type/,
    also: [
      "gates with different names", "gates you control", "gate you control", "urza's", "for each locus", "lair",
      "if you control a desert", "cave you control", "basic land types among lands you control", "domain",
      "for each forest you control", "for each island you control", "for each swamp you control",
      "for each mountain you control", "for each plains you control",
    ],
    name: "Land types",
    why: "counts land types, and every land has them all",
  },
  // Omo again: creatures that are every creature type count for every typal card.
  {
    when: /every creature type|changeling/,
    also: ["choose a creature type", "of the chosen type", "creature type of your choice", "shares a creature type", "changeling", "creatures of that type"],
    name: "Typal",
    why: "counts creature types, and every creature has them all",
  },
];

/** At most this many phrases go to the database in one wording search. */
export const MAX_WORDING_PHRASES = 24;

/** One idea the deck could build toward (Other angles): a mirror pair, or the commander's own wording. */
export type Angle = {
  /** The reason text, shared by its phrases in WordingPlan.why. */
  key: string;
  /** Button label: "Land types", "Omo's own wording". */
  name: string;
  /** Every phrase of this idea (one angle's search has room for all of them). */
  phrases: string[];
};

export type WordingPlan = {
  phrases: string[];
  /** phrase -> why it helps ("Same wording as Omo" or "Feeds Omo: makes lands enter"). */
  why: Record<string, string>;
  /** The ideas, own wording first. */
  angles: Angle[];
};

// "Omo, Queen of Vesuva" -> Omo; "Meren of Clan Nel Toth" -> Meren (as the card text calls itself).
const shortName = (name: string) => {
  const front = name.split(" // ")[0];
  return front.includes(",") ? front.split(",")[0].trim() : (front.match(/^(\S+) of /)?.[1] ?? front);
};
// Phrases in so many cards they'd swamp the row (draw a card is on about 1,500).
// Timing alone ("at the beginning of your end step") says nothing about what a card does.
const TOO_COMMON = new Set([
  "draw a card", "discard a card", "gain life", "create a treasure token", "exile the top card", "put into a graveyard", "put it into your hand",
  "at the beginning of your upkeep", "at the beginning of your end step", "at the beginning of combat on your turn", "at the beginning of each end step",
]);

/**
 * One phrase per reason: "choose a creature type" and "of the chosen type" are one idea (the same why), so a typal
 * card counts once and doesn't outscore a Gate card for wording the same thing twice. First phrase kept.
 */
export function onePerReason(says: string[], why: Record<string, string>): string[] {
  const seen = new Set<string>();
  return says.filter((p) => {
    const reason = why[p] ?? p;
    if (seen.has(reason)) return false;
    seen.add(reason);
    return true;
  });
}

/**
 * Best rows first, at most `perReason` per reason (a row's first phrase), so one idea (typal for Omo) can't fill
 * the whole Wording matches row; leftover slots go to the next best rows of any reason.
 */
export function spreadByReason<T extends { says?: string[] }>(rows: T[], why: Record<string, string>, limit = 8, perReason = 3): T[] {
  const used = new Map<string, number>();
  const picked = new Set<T>();
  for (const r of rows) {
    if (picked.size >= limit) break;
    const reason = why[r.says?.[0] ?? ""] ?? r.says?.[0] ?? "";
    if ((used.get(reason) ?? 0) >= perReason) continue;
    used.set(reason, (used.get(reason) ?? 0) + 1);
    picked.add(r);
  }
  for (const r of rows) if (picked.size < limit) picked.add(r);
  return rows.filter((r) => picked.has(r));
}

/** An angle as one Scryfall search: any of its phrases. */
export function angleQuery(angle: Pick<Angle, "phrases">): string {
  const parts = angle.phrases.map(wordingQuery);
  return parts.length > 1 ? `(${parts.join(" or ")})` : (parts[0] ?? "");
}

/** The phrases Suggest searches for: the commanders' own wording first, then what feeds it. */
export function wordingPlan(commanders: { name: string; type_line: string; text: string }[]): WordingPlan {
  const why: Record<string, string> = {};
  const own: string[] = [];
  const mirror: string[] = [];
  const angles = new Map<string, Angle>();
  const addTo = (key: string, name: string, p: string) => {
    if (!angles.has(key)) angles.set(key, { key, name, phrases: [] });
    angles.get(key)!.phrases.push(p);
  };
  for (const c of commanders) {
    const name = shortName(c.name);
    for (const p of wordingPhrases(c.text, c.name, c.type_line, 10)) {
      if (TOO_COMMON.has(p) || why[p]) continue;
      why[p] = `Same wording as ${name}`;
      own.push(p);
      addTo(why[p], `${name}'s own wording`, p);
    }
    const norm = normalizeOracle(c.text, c.name, c.type_line);
    for (const m of MIRRORS) {
      if (!m.when.test(norm)) continue;
      for (const p of m.also) {
        if (why[p]) continue;
        why[p] = `Feeds ${name}: ${m.why}`;
        mirror.push(p);
        addTo(why[p], m.name, p);
      }
    }
  }
  // Mirrors are the point (DefCat), so they get at least half the slots.
  const half = Math.floor(MAX_WORDING_PHRASES / 2);
  const ownTake = own.slice(0, Math.max(half, MAX_WORDING_PHRASES - mirror.length));
  const phrases = [...ownTake, ...mirror].slice(0, MAX_WORDING_PHRASES);
  // Every phrase of every angle keeps its reason, even one left out of the mixed search.
  return {
    phrases,
    why: Object.fromEntries([...angles.values()].flatMap((a) => a.phrases.map((p) => [p, a.key]))),
    angles: [...angles.values()].map((a) => ({ ...a, phrases: a.phrases.slice(0, MAX_WORDING_PHRASES) })),
  };
}
