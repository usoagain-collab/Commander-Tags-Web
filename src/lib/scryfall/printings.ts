// A card's printings, fetched live from Scryfall when the picker opens: storing every printing would not fit the
// free database (CLAUDE.md, Data layer). Remembered for the rest of the visit.
import { foilFor, type ChosenPrinting } from "@/lib/deck/printing";

export type ScryfallPrint = {
  id: string;
  oracle_id?: string;
  set: string;
  set_name: string;
  collector_number: string;
  released_at?: string;
  illustration_id?: string;
  finishes?: string[];
  prices?: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null };
  card_faces?: { oracle_id?: string; illustration_id?: string }[];
};

const price = (s: string | null | undefined) => (s ? Number(s) : null);

/** A Scryfall card as a deck row's choice. Foil follows what this printing can be. */
export function toPrinting(c: ScryfallPrint, foil: boolean): ChosenPrinting {
  const finishes = c.finishes ?? ["nonfoil"];
  return {
    id: c.id,
    set: c.set,
    set_name: c.set_name,
    number: c.collector_number,
    illustration_id: c.illustration_id ?? c.card_faces?.[0]?.illustration_id ?? null,
    finishes,
    usd: price(c.prices?.usd),
    usd_foil: price(c.prices?.usd_foil),
    usd_etched: price(c.prices?.usd_etched),
    foil: foilFor(finishes, foil),
  };
}

export const oracleIdOf = (c: ScryfallPrint) => c.oracle_id ?? c.card_faces?.[0]?.oracle_id ?? null;

type Page = { prints: ChosenPrinting[]; next: string | null };
const pages = new Map<string, Promise<Page>>();

/** One page of paper printings, newest first (175 a page). Pass `next` for the following page. */
export function fetchPrintings(oracleId: string, next?: string): Promise<Page> {
  const url =
    next ??
    `https://api.scryfall.com/cards/search?${new URLSearchParams({
      q: `oracleid:${oracleId} game:paper`,
      unique: "prints",
      order: "released",
      dir: "desc",
    })}`;
  if (!pages.has(url)) {
    const p = (async () => {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.status === 404) return { prints: [], next: null };
      if (!res.ok) throw new Error(`Scryfall returned ${res.status}`);
      const body = (await res.json()) as { data: ScryfallPrint[]; has_more?: boolean; next_page?: string };
      return { prints: body.data.map((c) => toPrinting(c, false)), next: body.has_more ? (body.next_page ?? null) : null };
    })();
    p.catch(() => pages.delete(url));
    pages.set(url, p);
  }
  return pages.get(url)!;
}

/** One printing by its id: the default printing may not be on the page of paper printings loaded so far. */
export async function fetchPrinting(id: string): Promise<ChosenPrinting> {
  const res = await fetch(`https://api.scryfall.com/cards/${id}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Scryfall returned ${res.status}`);
  return toPrinting((await res.json()) as ScryfallPrint, false);
}

const ref = (set: string, number: string) => `${set.toLowerCase()}|${number.toLowerCase()}`;
export const printingRef = ref;

/**
 * Printings named in an imported list, by set and collector number, keyed by printingRef. Scryfall takes 75 per
 * request. Each result carries its oracle id, so a wrong code on a line can be ignored.
 */
export async function fetchPrintingsByRef(refs: { set: string; number: string }[]) {
  const found = new Map<string, { printing: ChosenPrinting; oracleId: string | null }>();
  for (let i = 0; i < refs.length; i += 75) {
    if (i) await new Promise((r) => setTimeout(r, 110)); // Scryfall asks for at most 10 requests a second
    const res = await fetch("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: refs.slice(i, i + 75).map((r) => ({ set: r.set, collector_number: r.number })) }),
    });
    if (!res.ok) throw new Error(`Scryfall returned ${res.status}`);
    const body = (await res.json()) as { data: ScryfallPrint[] };
    for (const c of body.data) found.set(ref(c.set, c.collector_number), { printing: toPrinting(c, false), oracleId: oracleIdOf(c) });
  }
  return found;
}
