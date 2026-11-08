// Collection tracking (v2, migration 0038): copies owned per card (oracle id), plain and foil.
// Pure helpers: reading collection exports, owned checks for a deck, the unowned price.
import type { DeckLine } from "./model";

export type Owned = { quantity: number; foil_quantity: number };
export type Collection = Map<string, Owned>;
export const ownedCopies = (c: Collection, oracleId: string) => {
  const o = c.get(oracleId);
  return o ? o.quantity + o.foil_quantity : 0;
};

/** One card from an export: its name, copies, and whether those copies are foil. */
export type ImportedCard = { name: string; quantity: number; foil: boolean; scryfallId?: string };

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

const FOIL = /^(foil|etched|true|yes|1)$/i;

/**
 * Reads a collection export: CSV from Moxfield (Count, Name, Foil), Archidekt (Quantity, Name, Finish), ManaBox
 * (Name, Foil, Quantity, Scryfall ID) and similar, or a plain list ("4 Lightning Bolt", "1x Sol Ring *F*").
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
    for (const line of lines.slice(1)) {
      const f = csvFields(line);
      const name = f[nameAt];
      const quantity = qtyAt >= 0 ? Number.parseInt(f[qtyAt], 10) : 1;
      if (!name || !Number.isFinite(quantity) || quantity <= 0) {
        skipped++;
        continue;
      }
      cards.push({ name, quantity, foil: foilAt >= 0 && FOIL.test(f[foilAt] ?? ""), scryfallId: idAt >= 0 ? f[idAt] || undefined : undefined });
    }
  } else {
    for (const line of lines) {
      const m = /^(\d+)\s*x?\s+(.+?)(?:\s+\([A-Za-z0-9]+\)(?:\s+\S+)?)?(\s+\*[FE]\*)?$/.exec(line);
      if (!m) {
        skipped++;
        continue;
      }
      cards.push({ name: m[2].trim(), quantity: Number(m[1]), foil: !!m[3] });
    }
  }
  return { cards, skipped };
}

/** Adds up copies per card once names are resolved to oracle ids (several printings of one card are one row). */
export function mergeImported(rows: { oracleId: string; quantity: number; foil: boolean }[]): Map<string, Owned> {
  const out = new Map<string, Owned>();
  for (const r of rows) {
    const o = out.get(r.oracleId) ?? { quantity: 0, foil_quantity: 0 };
    if (r.foil) o.foil_quantity += r.quantity;
    else o.quantity += r.quantity;
    out.set(r.oracleId, o);
  }
  return out;
}

/** Owned state of a deck line: all copies, some, or none. */
export function ownedState(c: Collection, line: Pick<DeckLine, "quantity" | "card">): "all" | "some" | "none" {
  const have = ownedCopies(c, line.card.oracle_id);
  return have >= line.quantity ? "all" : have > 0 ? "some" : "none";
}

/** The price of the copies the deck needs that you don't own (basic lands are skipped). */
export function unownedPrice(c: Collection, lines: Pick<DeckLine, "quantity" | "card">[]): number {
  let total = 0;
  for (const l of lines) {
    if (/\bBasic\b/.test(l.card.type_line)) continue;
    const missing = Math.max(0, l.quantity - ownedCopies(c, l.card.oracle_id));
    total += missing * (l.card.price_usd ?? 0);
  }
  return total;
}
