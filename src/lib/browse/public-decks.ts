// Browse public decks and Commander pages (V3). Reads only what row-level security lets anyone see: public decks
// (the precons are public decks too), their card rows, and card details. No migration.
//
// This first version reads the 300 most recently changed public decks that match the commander and bracket
// filters, then filters colors and pages in memory. That is plenty while Deck Genome has hundreds of public
// decks; past a few thousand it wants a database function and an index on decks (visibility, updated_at).
import type { SupabaseClient } from "@supabase/supabase-js";

export const PAGE_SIZE = 48;
const SCAN = 300;
const COLOR_ORDER = "WUBRG";

export type BrowseQuery = { q: string; colors: string; bracket: number | null; precons: boolean; page: number };
export type DeckTile = {
  id: string;
  name: string;
  updated_at: string;
  bracket: number | null;
  precon: boolean;
  commanders: { oracle_id: string; name: string; art: string | null; artist: string | null }[];
  identity: string[];
};

/** Reads ?q=&colors=WU&bracket=3&precons=1&page=2, ignoring anything it doesn't understand. */
export function parseBrowseQuery(params: Record<string, string | string[] | undefined>): BrowseQuery {
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  // Color checkboxes send one colors= per color; a link sends them joined ("WU").
  const raw = params.colors;
  const colors = (Array.isArray(raw) ? raw.join("") : (raw ?? "")).toUpperCase();
  const bracket = Number(one("bracket"));
  const page = Number(one("page"));
  return {
    q: one("q").trim().slice(0, 80),
    colors: colors === "C" ? "C" : normalizeColors(colors),
    bracket: Number.isInteger(bracket) && bracket >= 1 && bracket <= 5 ? bracket : null,
    precons: one("precons") === "1",
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** "gUw" -> "WUG": the colors in WUBRG order, each once, nothing else. */
export function normalizeColors(s: string) {
  const set = new Set(s.toUpperCase());
  return [...COLOR_ORDER].filter((c) => set.has(c)).join("");
}

/** Exact color identity: "WU" matches only Azorius decks, "C" only colorless ones, "" any. */
export function matchesColors(identity: string[], colors: string) {
  if (!colors) return true;
  if (colors === "C") return identity.length === 0;
  return normalizeColors(identity.join("")) === colors;
}

/** The same query with some fields changed, as a search string for a link (page goes back to 1 unless set). */
export function browseHref(base: BrowseQuery, change: Partial<BrowseQuery>, path = "/browse") {
  const q = { ...base, page: 1, ...change };
  const sp = new URLSearchParams();
  if (q.q) sp.set("q", q.q);
  if (q.colors) sp.set("colors", q.colors);
  if (q.bracket) sp.set("bracket", String(q.bracket));
  if (q.precons) sp.set("precons", "1");
  if (q.page > 1) sp.set("page", String(q.page));
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

type Summary = { oracle_id: string; name: string; image_art_crop: string | null; artist: string | null; color_identity: string[] };

/** Commanders whose name contains the words, for the search box (at most 40). */
export async function commandersNamed(supabase: SupabaseClient, q: string): Promise<string[]> {
  const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const { data, error } = await supabase.from("card_summaries").select("oracle_id").eq("can_be_commander", true).ilike("name", pattern).limit(40);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.oracle_id as string);
}

/**
 * Public decks, newest change first, with their commanders. `commanderIds` limits it to decks led by one of those
 * cards (null = any). Returns the page asked for and whether there is another.
 */
export async function loadPublicDecks(
  supabase: SupabaseClient,
  query: Pick<BrowseQuery, "colors" | "bracket" | "precons" | "page">,
  commanderIds: string[] | null,
): Promise<{ decks: DeckTile[]; more: boolean }> {
  if (commanderIds && commanderIds.length === 0) return { decks: [], more: false };
  let req = supabase
    .from("decks")
    .select("id, name, updated_at, target_bracket, precon, deck_cards!inner(oracle_id)")
    .eq("visibility", "public")
    .eq("deck_cards.board", "commander")
    .order("updated_at", { ascending: false })
    .limit(SCAN);
  if (!query.precons) req = req.is("precon", null);
  if (query.bracket) req = req.eq("target_bracket", query.bracket);
  if (commanderIds) req = req.in("deck_cards.oracle_id", commanderIds);
  const { data, error } = await req;
  if (error) throw new Error(error.message);
  type Row = { id: string; name: string; updated_at: string; target_bracket: number | null; precon: unknown };
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { decks: [], more: false };

  // Every commander of these decks (a commander filter only returned the matching one), then their details.
  const cmd = new Map<string, string[]>();
  for (let i = 0; i < rows.length; i += 100) {
    const { data: cr, error: ce } = await supabase
      .from("deck_cards")
      .select("deck_id, oracle_id")
      .eq("board", "commander")
      .in(
        "deck_id",
        rows.slice(i, i + 100).map((r) => r.id),
      );
    if (ce) throw new Error(ce.message);
    for (const r of cr ?? []) cmd.set(r.deck_id as string, [...(cmd.get(r.deck_id as string) ?? []), r.oracle_id as string]);
  }
  const ids = [...new Set([...cmd.values()].flat())];
  const cards = new Map<string, Summary>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data: cs, error: se } = await supabase
      .from("card_summaries")
      .select("oracle_id, name, image_art_crop, artist, color_identity")
      .in("oracle_id", ids.slice(i, i + 100));
    if (se) throw new Error(se.message);
    for (const c of (cs ?? []) as Summary[]) cards.set(c.oracle_id, c);
  }

  const tiles = rows.map((r): DeckTile => {
    const own = (cmd.get(r.id) ?? []).flatMap((id) => cards.get(id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: r.id,
      name: r.name,
      updated_at: r.updated_at,
      bracket: r.target_bracket,
      precon: r.precon != null,
      commanders: own.map((c) => ({ oracle_id: c.oracle_id, name: c.name, art: c.image_art_crop, artist: c.artist })),
      identity: [...COLOR_ORDER].filter((c) => own.some((o) => o.color_identity.includes(c))),
    };
  });
  const matching = tiles.filter((t) => matchesColors(t.identity, query.colors));
  const start = (query.page - 1) * PAGE_SIZE;
  return { decks: matching.slice(start, start + PAGE_SIZE), more: matching.length > start + PAGE_SIZE };
}
