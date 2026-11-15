// Try the builder before signing in (V3): a visitor builds one deck that lives only in this browser (local
// storage). Signing in from it moves the deck into the new account (/try/save) in one apply_deck_changes call,
// the same call every edit uses, so the database checks it like any other edit. No migration.
import { BOARDS, entryKey, parseKey, toSavePayload, type Board, type CardSummary, type Categories, type Change, type Entries, type Printings, type SavePayload } from "./model";

export const GUEST_KEY = "deckgenome:guest-deck";
/** Stands in for a deck id while the deck has none; never saved anywhere. */
export const GUEST_DECK_ID = "00000000-0000-4000-8000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A Commander deck plus a full maybeboard fits well inside this. */
const MAX_ROWS = 400;

export type GuestDeck = {
  v: 1;
  name: string;
  entries: Entries;
  categories: Categories;
  printings: Printings;
  /** Details of the cards in the deck, so it opens without asking the database. */
  cards: Record<string, CardSummary>;
};

export const emptyGuestDeck = (): GuestDeck => ({ v: 1, name: "My first deck", entries: {}, categories: {}, printings: {}, cards: {} });

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const validKey = (k: string) => {
  const { board, oracle_id } = parseKey(k);
  return BOARDS.includes(board as Board) && UUID.test(oracle_id ?? "");
};

/** Reads what local storage held, keeping only well-formed rows. Anything unreadable gives an empty deck. */
export function readGuestDeck(raw: string | null): GuestDeck {
  let x: unknown;
  try {
    x = raw ? JSON.parse(raw) : null;
  } catch {
    return emptyGuestDeck();
  }
  if (!isObject(x) || x.v !== 1) return emptyGuestDeck();
  const entries: Entries = {};
  for (const [k, n] of Object.entries(isObject(x.entries) ? x.entries : {})) {
    if (validKey(k) && Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 99) entries[k] = n as number;
    if (Object.keys(entries).length >= MAX_ROWS) break;
  }
  const keep = <T>(src: unknown, ok: (v: unknown) => boolean) =>
    Object.fromEntries(Object.entries(isObject(src) ? src : {}).filter(([k, v]) => entries[k] && ok(v))) as Record<string, T>;
  const categories = keep<string>(x.categories, (v) => typeof v === "string" && v.length <= 60);
  const printings = keep<Printings[string]>(x.printings, (v) => isObject(v) && typeof v.id === "string" && UUID.test(v.id));
  const ids = new Set(Object.keys(entries).map((k) => parseKey(k).oracle_id));
  const cards = Object.fromEntries(
    Object.entries(isObject(x.cards) ? x.cards : {}).filter(([id, c]) => ids.has(id) && isObject(c) && c.oracle_id === id && typeof c.name === "string"),
  ) as Record<string, CardSummary>;
  const name = typeof x.name === "string" && x.name.trim() ? x.name.trim().slice(0, 120) : emptyGuestDeck().name;
  return { v: 1, name, entries, categories, printings, cards };
}

/** What to keep: the deck as it stands, with details only for the cards still in it. */
export function guestSnapshot(name: string, entries: Entries, categories: Categories, printings: Printings, cards: Record<string, CardSummary>): GuestDeck {
  const ids = new Set(Object.keys(entries).map((k) => parseKey(k).oracle_id));
  return { v: 1, name, entries, categories, printings, cards: Object.fromEntries([...ids].flatMap((id) => (cards[id] ? [[id, cards[id]]] : []))) };
}

/** The guest deck as one save call: every row added from nothing, with its category and printing. */
export function guestSavePayload(deck: GuestDeck): SavePayload {
  const keys = Object.keys(deck.entries);
  const change: Change = {
    label: "Saved from your browser",
    rows: keys.map((k) => ({ ...parseKey(k), from: 0, to: deck.entries[k] })),
    categories: keys.filter((k) => deck.categories[k]).map((k) => ({ ...parseKey(k), from: null, to: deck.categories[k] })),
    printings: keys.filter((k) => deck.printings[k]).map((k) => ({ ...parseKey(k), from: null, to: deck.printings[k] })),
  };
  return toSavePayload(change);
}

export const hasCards = (deck: GuestDeck) => Object.keys(deck.entries).length > 0;
export { entryKey };
