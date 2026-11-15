import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Public pages, every precon deck (public decks owned by the precon account) and a page per commander of a public
// deck, so search engines can find them.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = `https://${(await headers()).get("host") ?? "deckgenome.com"}`;
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/precons`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/browse`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/guide`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
  const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await supabase.from("decks").select("id, updated_at").not("precon", "is", null).eq("visibility", "public").limit(1000);
  for (const d of data ?? []) pages.push({ url: `${base}/decks/${d.id}`, lastModified: d.updated_at, changeFrequency: "monthly", priority: 0.6 });
  // Commander pages (V3) for every commander that leads a public deck, precons included.
  const { data: leads } = await supabase
    .from("deck_cards")
    .select("oracle_id, decks!inner(visibility)")
    .eq("board", "commander")
    .eq("decks.visibility", "public")
    .limit(5000);
  for (const id of new Set((leads ?? []).map((r) => r.oracle_id as string)))
    pages.push({ url: `${base}/commanders/${id}`, changeFrequency: "weekly", priority: 0.5 });
  return pages;
}
