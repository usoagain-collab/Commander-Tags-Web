// Public decks read signed out (no cookies), cached per query: shared by /browse and the home page. Tag "browse"
// lets the My decks Public switch clear it at once; otherwise it refreshes every five minutes.
import { unstable_cache } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { commandersNamed, loadPublicDecks, type BrowseQuery, type DeckTile } from "./public-decks";

const anon = () =>
  createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

export const searchPublicDecks = unstable_cache(
  async (query: BrowseQuery) => {
    const supabase = anon();
    const ids = query.q ? await commandersNamed(supabase, query.q) : null;
    return loadPublicDecks(supabase, query, ids);
  },
  ["browse-decks"],
  { revalidate: 300, tags: ["browse"] },
);

const NO_FILTER: BrowseQuery = { q: "", colors: "", bracket: null, precons: false, page: 1 };

/**
 * The home page row: the newest public decks people built. While there are few, the newest precons fill it up to
 * `fill`, so the row never looks empty; people's own decks always come first.
 */
export async function recentPublicDecks(limit = 8, fill = 4): Promise<DeckTile[]> {
  const own = (await searchPublicDecks(NO_FILTER)).decks.slice(0, limit);
  if (own.length >= fill) return own;
  const withPrecons = (await searchPublicDecks({ ...NO_FILTER, precons: true })).decks;
  const seen = new Set(own.map((d) => d.id));
  return [...own, ...withPrecons.filter((d) => d.precon && !seen.has(d.id)).slice(0, fill - own.length)];
}
