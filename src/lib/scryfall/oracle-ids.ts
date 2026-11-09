// The cards a Scryfall search finds, as oracle ids (v2, Nov 8, 2026: Suggest filters). Suggest narrows its pool to
// these, so the filters can use anything Scryfall knows (first printings, the Reserved List, rules text).
// Reads up to `maxPages` pages of 175, most played first, about 110 ms apart (Scryfall asks for 10 a second at most).

export type ScryfallIds = {
  ids: string[];
  /** Cards Scryfall found in all (more than ids.length when the pages ran out). */
  total: number;
  warnings: string[];
};

type Page = {
  data: { oracle_id?: string; card_faces?: { oracle_id?: string }[] }[];
  has_more: boolean;
  next_page?: string;
  total_cards: number;
  warnings?: string[];
};

export async function scryfallOracleIds(query: string, maxPages = 3): Promise<ScryfallIds> {
  const params = new URLSearchParams({ q: query, order: "edhrec", unique: "cards" });
  let url: string | undefined = `https://api.scryfall.com/cards/search?${params}`;
  const ids = new Set<string>();
  let total = 0;
  let warnings: string[] = [];
  for (let page = 0; url && page < maxPages; page++) {
    if (page) await new Promise((r) => setTimeout(r, 110));
    const res: Response = await fetch(url, { headers: { Accept: "application/json" } });
    const body = await res.json();
    // No results is a 404 on Scryfall.
    if (res.status === 404) return { ids: [], total: 0, warnings: body.warnings ?? [] };
    if (!res.ok) throw new Error(body.details ?? `Scryfall returned an error (${res.status}).`);
    const list = body as Page;
    if (!page) warnings = list.warnings ?? [];
    total = list.total_cards;
    for (const c of list.data) {
      const id = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
      if (id) ids.add(id);
    }
    url = list.has_more ? list.next_page : undefined;
  }
  return { ids: [...ids], total, warnings };
}
