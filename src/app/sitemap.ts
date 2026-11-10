import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Public pages plus every precon deck (public decks owned by the precon account), so search engines can find them.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = `https://${(await headers()).get("host") ?? "deckgenome.com"}`;
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/precons`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
  const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await supabase.from("decks").select("id, updated_at").not("precon", "is", null).eq("visibility", "public").limit(1000);
  for (const d of data ?? []) pages.push({ url: `${base}/decks/${d.id}`, lastModified: d.updated_at, changeFrequency: "monthly", priority: 0.6 });
  return pages;
}
