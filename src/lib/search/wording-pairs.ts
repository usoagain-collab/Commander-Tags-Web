// Wording matches for Suggest (v2, Nov 10, 2026; DefCat lesson 3). Two kinds of phrases:
//  - the commander's own wording (wordingPhrases): cards that say the same thing;
//  - mirror phrases from MIRRORS: when the commander's text says X, cards that CAUSE X. Landfall wants cards that
//    make lands enter, not only more landfall cards. This list is a draft for David to review: every phrase is plain
//    rules text in lower case, as Scryfall writes it today ("enters", not "enters the battlefield"), matched inside
//    cards.oracle_norm by SQL cards_with_wording (migration 0048).
import { normalizeOracle, wordingPhrases } from "./wording";

export type Mirror = {
  /** Tested against the commander's normalized rules text (lower case, own name as ~). */
  when: RegExp;
  /** Phrases a card that feeds it would say. */
  also: string[];
  /** Why a card saying one of them helps, after "Feeds your commander: ". */
  why: string;
};

export const MIRRORS: Mirror[] = [
  {
    when: /whenever (a|one or more) lands? you control enters|landfall/,
    also: ["return a land you control to its owner's hand", "you may play an additional land", "put a land card from your hand onto the battlefield", "play lands from your graveyard", "search your library for a basic land card, put it onto the battlefield"],
    why: "makes lands enter",
  },
  {
    when: /whenever (a|another|one or more) (nontoken )?creatures?( you control)? dies?/,
    also: ["sacrifice a creature", "sacrifice another creature", "destroy all creatures", "each player sacrifices a creature"],
    why: "makes creatures die",
  },
  {
    when: /whenever (a|another|one or more) (nontoken )?creatures?( you control)? enters|when ~ enters/,
    also: ["exile target creature you control, then return", "return it to the battlefield", "return those cards to the battlefield", "create a token that's a copy of"],
    why: "makes creatures enter again",
  },
  {
    when: /whenever you discard|whenever a player discards/,
    also: ["discard a card", "discard your hand", "draw two cards, then discard", "each player discards"],
    why: "makes you discard",
  },
  {
    when: /whenever you gain life/,
    also: ["you gain 1 life", "each opponent loses 1 life and you gain", "gain life equal to"],
    why: "gains life again and again",
  },
  {
    when: /whenever you sacrifice|sacrifice (a|another) (creature|permanent|artifact)/,
    also: ["create a 1/1", "create two 1/1", "return target creature card from your graveyard to the battlefield"],
    why: "gives you things to sacrifice",
  },
  {
    when: /\+1\/\+1 counters?|whenever one or more counters/,
    also: ["proliferate", "double the number of", "that many plus one", "with an additional +1/+1 counter"],
    why: "multiplies counters",
  },
  {
    when: /everything counter|loyalty counter|charge counter|oil counter|experience counter/,
    also: ["proliferate"],
    why: "adds more counters",
  },
  {
    when: /create [^.]*tokens?|whenever (a|one or more) [^.]*tokens? /,
    also: ["populate", "twice that many", "create that many", "create a token that's a copy of"],
    why: "makes more tokens",
  },
  {
    when: /whenever you cast an instant or sorcery|whenever you cast a noncreature spell|whenever you cast your second spell/,
    also: ["copy target instant or sorcery spell", "costs {1} less to cast", "flashback"],
    why: "casts more spells for less",
  },
  {
    when: /whenever ~ attacks|whenever you attack|whenever (a|one or more) creatures? you control attacks?/,
    also: ["additional combat phase", "untap all creatures you control", "can't be blocked"],
    why: "attacks more often",
  },
  {
    when: /whenever ~ deals combat damage to a player|whenever (a|one or more) creatures? you control deals? combat damage to a player/,
    also: ["can't be blocked", "gains double strike", "has double strike"],
    why: "gets damage through",
  },
  {
    when: /whenever you draw|whenever a player draws|whenever an opponent draws/,
    also: ["each player draws", "target player draws", "draw two cards", "draws a card for each"],
    why: "makes cards get drawn",
  },
  {
    when: /from your graveyard|cards? in your graveyard/,
    also: ["mill three cards", "mill four cards", "surveil 2", "put the top three cards of your library into your graveyard"],
    why: "fills your graveyard",
  },
  {
    when: /whenever an artifact( you control)? enters|whenever one or more artifacts/,
    also: ["create a treasure token", "create a clue token", "investigate", "create a food token"],
    why: "makes artifacts enter",
  },
  {
    when: /whenever an enchantment( you control)? enters|constellation/,
    also: ["enchantment creature token", "return target enchantment card from your graveyard"],
    why: "makes enchantments enter",
  },
  {
    when: /leaves the battlefield|whenever ~ is put into a graveyard/,
    also: ["exile target creature you control, then return", "return target creature you control to its owner's hand"],
    why: "makes it leave and come back",
  },
  {
    when: /\bmill\b|whenever one or more cards are put into your graveyard from your library/,
    also: ["mill three cards", "each player mills", "target player mills"],
    why: "mills more",
  },
  {
    when: /whenever ~ becomes tapped|whenever you tap|untap target/,
    also: ["untap target permanent", "untap another target"],
    why: "untaps permanents",
  },
  {
    when: /\bscry\b|\bsurveil\b|whenever you scry/,
    also: ["scry 1", "scry 2", "surveil 1", "surveil 2"],
    why: "scries or surveils",
  },
];

/** At most this many phrases go to the database in one wording search. */
export const MAX_WORDING_PHRASES = 24;

export type WordingPlan = {
  phrases: string[];
  /** phrase -> why it helps ("Same wording as Omo" or "Feeds Omo: makes lands enter"). */
  why: Record<string, string>;
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

/** The phrases Suggest searches for: the commanders' own wording first, then what feeds it. */
export function wordingPlan(commanders: { name: string; type_line: string; text: string }[]): WordingPlan {
  const why: Record<string, string> = {};
  const own: string[] = [];
  const mirror: string[] = [];
  for (const c of commanders) {
    const name = shortName(c.name);
    for (const p of wordingPhrases(c.text, c.name, c.type_line, 10)) {
      if (TOO_COMMON.has(p) || why[p]) continue;
      why[p] = `Same wording as ${name}`;
      own.push(p);
    }
    const norm = normalizeOracle(c.text, c.name, c.type_line);
    for (const m of MIRRORS) {
      if (!m.when.test(norm)) continue;
      for (const p of m.also) {
        if (why[p]) continue;
        why[p] = `Feeds ${name}: ${m.why}`;
        mirror.push(p);
      }
    }
  }
  // Mirrors are the point (DefCat), so they get at least half the slots.
  const half = Math.floor(MAX_WORDING_PHRASES / 2);
  const ownTake = own.slice(0, Math.max(half, MAX_WORDING_PHRASES - mirror.length));
  const phrases = [...ownTake, ...mirror].slice(0, MAX_WORDING_PHRASES);
  return { phrases, why: Object.fromEntries(phrases.map((p) => [p, why[p]])) };
}
