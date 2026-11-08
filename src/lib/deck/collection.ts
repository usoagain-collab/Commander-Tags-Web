// Collection tracking (v2): copies owned per card, printing and finish (migration 0040, table collection_cards).
// A null printing means "printing unknown" (plain lists, and everything imported before 0040).
// Pure helpers: reading collection exports, owned checks for a deck, the unowned price, CSV export.
import type { DeckLine } from "./model";
import { foilFor, type ChosenPrinting } from "./printing";

export type Finish = "nonfoil" | "foil" | "etched";
/** What a collection row remembers about its printing (copied at add time, like a deck row's printing). */
export type PrintingInfo = Omit<ChosenPrinting, "id" | "foil">;

export type OwnedRow = {
  id?: string;
  oracle_id: string;
  printing_id: string | null;
  finish: Finish;
  quantity: number;
  printing_info: PrintingInfo | null;
  added_at?: string;
};
/** Rows by oracle id. */
export type Collection = Map<string, OwnedRow[]>;

export const isFoilFinish = (f: Finish) => f !== "nonfoil";
/** One row per card, printing and finish: the database's unique key. */
export const rowKey = (r: Pick<OwnedRow, "oracle_id" | "printing_id" | "finish">) => `${r.oracle_id}|${r.printing_id ?? ""}|${r.finish}`;

export function groupRows(rows: OwnedRow[]): Collection {
  const out: Collection = new Map();
  for (const r of rows) {
    const list = out.get(r.oracle_id);
    if (list) list.push(r);
    else out.set(r.oracle_id, [r]);
  }
  return out;
}

export const ownedCopies = (c: Collection, oracleId: string) => (c.get(oracleId) ?? []).reduce((s, r) => s + r.quantity, 0);

/**
 * Copies of one exact printing, foil or not (etched counts as foil, as in deck prices), as that printing can be:
 * a foil-only printing matches a row that never asked for foil. Unknown printings never match.
 */
export const exactCopies = (c: Collection, oracleId: string, printingId: string | null, foil: boolean) =>
  printingId
    ? (c.get(oracleId) ?? [])
        .filter((r) => r.printing_id === printingId && isFoilFinish(r.finish) === (r.printing_info ? foilFor(r.printing_info.finishes, foil) : foil))
        .reduce((s, r) => s + r.quantity, 0)
    : 0;

/** The copies a deck row shows: printing by printing (several when the row has mixed copies). */
export type WantedPart = { printingId: string | null; foil: boolean; quantity: number };

/**
 * How a deck row compares to your collection: `have` = copies of the card in any printing, `exact` = copies that
 * are the very printing and finish the deck shows (David, Nov 8, 2026: no pick still means the printing on screen).
 */
export function ownedMatch(c: Collection, oracleId: string, parts: WantedPart[]) {
  const need = parts.reduce((s, p) => s + p.quantity, 0);
  const wanted = new Map<string, WantedPart>();
  for (const p of parts) {
    const k = `${p.printingId}|${p.foil}`;
    const had = wanted.get(k);
    wanted.set(k, had ? { ...had, quantity: had.quantity + p.quantity } : p);
  }
  let exact = 0;
  for (const p of wanted.values()) exact += Math.min(p.quantity, exactCopies(c, oracleId, p.printingId, p.foil));
  return { have: ownedCopies(c, oracleId), exact, need };
}

/** green = every copy in the exact printing, orange = enough copies but some in other printings, some = not enough. */
export function ownedState(m: { have: number; exact: number; need: number }): "exact" | "other" | "some" | "none" {
  if (m.exact >= m.need) return "exact";
  if (m.have >= m.need) return "other";
  return m.have > 0 ? "some" : "none";
}

/** The price of the copies the deck needs that you don't own in any printing (basic lands are skipped). */
export function unownedPrice(c: Collection, lines: Pick<DeckLine, "quantity" | "card">[]): number {
  let total = 0;
  for (const l of lines) {
    if (/\bBasic\b/.test(l.card.type_line)) continue;
    const missing = Math.max(0, l.quantity - ownedCopies(c, l.card.oracle_id));
    total += missing * (l.card.price_usd ?? 0);
  }
  return total;
}

/** What one owned row is worth each: its own printing and finish when known, else the card's cheapest price. */
export function rowUnitPrice(r: OwnedRow, fallback: number | null): number {
  const p = r.printing_info;
  if (!p) return fallback ?? 0;
  const v = r.finish === "etched" ? (p.usd_etched ?? p.usd_foil) : r.finish === "foil" ? (p.usd_foil ?? p.usd_etched) : p.usd;
  return v ?? fallback ?? 0;
}

/** One card from an export: its name, copies, finish, and its printing when the export names one. */
export type ImportedCard = { name: string; quantity: number; finish: Finish; scryfallId?: string; set?: string; number?: string };

/** Splits one CSV line, honoring quotes ("Jace, the Mind Sculptor" stays one field). */
export function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

const FOIL = /^(foil|true|yes|1)$/i;
const finishOf = (v: string | undefined): Finish => (/etched/i.test(v ?? "") ? "etched" : FOIL.test(v ?? "") ? "foil" : "nonfoil");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A set code, not a set name (Deckbox writes the name under Edition). */
const SET_CODE = /^[a-z0-9]{2,5}$/i;

/**
 * Reads a collection export: CSV from Moxfield (Count, Name, Edition, Foil, Collector Number), Archidekt (Quantity,
 * Name, Finish, Edition Code, Collector Number, Scryfall ID), ManaBox (Name, Set code, Collector number, Foil,
 * Quantity, Scryfall ID) and similar, or a plain list ("4 Lightning Bolt", "1x Sol Ring (CMR) 472 *F*").
 */
export function parseCollection(text: string): { cards: ImportedCard[]; skipped: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { cards: [], skipped: 0 };
  const header = csvFields(lines[0]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const nameAt = col("name", "card name", "card");
  const cards: ImportedCard[] = [];
  let skipped = 0;
  if (lines[0].includes(",") && nameAt >= 0) {
    const qtyAt = col("count", "quantity", "qty", "amount");
    const foilAt = col("foil", "finish", "printing", "foil/etched");
    const idAt = col("scryfall id", "scryfall_id", "scryfallid");
    const setAt = col("set code", "edition code", "set", "edition");
    const numAt = col("collector number", "collector_number", "card number", "number", "cn");
    for (const line of lines.slice(1)) {
      const f = csvFields(line);
      const name = f[nameAt];
      const quantity = qtyAt >= 0 ? Number.parseInt(f[qtyAt], 10) : 1;
      if (!name || !Number.isFinite(quantity) || quantity <= 0) {
        skipped++;
        continue;
      }
      const card: ImportedCard = { name, quantity, finish: foilAt >= 0 ? finishOf(f[foilAt]) : "nonfoil" };
      const id = idAt >= 0 ? f[idAt] : "";
      if (id && UUID.test(id)) card.scryfallId = id.toLowerCase();
      const set = setAt >= 0 ? f[setAt] : "";
      const number = numAt >= 0 ? f[numAt] : "";
      if (set && number && SET_CODE.test(set)) {
        card.set = set.toLowerCase();
        card.number = number;
      }
      cards.push(card);
    }
  } else {
    for (const line of lines) {
      const m = /^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]+)\)(?:\s+(\S+?))?)?(?:\s+\*([FE])\*)?$/.exec(line);
      if (!m) {
        skipped++;
        continue;
      }
      const card: ImportedCard = { name: m[2].trim(), quantity: Number(m[1]), finish: m[5] === "E" ? "etched" : m[5] === "F" ? "foil" : "nonfoil" };
      if (m[3] && m[4]) {
        card.set = m[3].toLowerCase();
        card.number = m[4];
      }
      cards.push(card);
    }
  }
  return { cards, skipped };
}

/** Adds up imported copies per card, printing and finish once each line is resolved. */
export function mergeImported(rows: OwnedRow[]): OwnedRow[] {
  const out = new Map<string, OwnedRow>();
  for (const r of rows) {
    const k = rowKey(r);
    const had = out.get(k);
    out.set(k, had ? { ...had, quantity: Math.min(9999, had.quantity + r.quantity) } : { ...r });
  }
  return [...out.values()];
}

/** A Moxfield-style collection CSV (Count, Name, Edition, Collector Number, Foil); unknown printings leave both blank. */
export function exportCollectionCsv(rows: OwnedRow[], nameOf: (oracleId: string) => string | undefined): string {
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = ["Count,Name,Edition,Collector Number,Foil"];
  for (const r of rows) {
    const name = nameOf(r.oracle_id);
    if (!name) continue;
    const p = r.printing_info;
    lines.push([r.quantity, quote(name), p?.set ?? "", p ? quote(p.number) : "", r.finish === "nonfoil" ? "" : r.finish].join(","));
  }
  return lines.join("\n");
}
