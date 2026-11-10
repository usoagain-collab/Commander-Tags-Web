import { unstable_cache } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PreconsView, type PreconTile } from "./precons-view";

export const metadata = {
  title: "Commander precons · Deck Genome",
  description: "Every Commander precon deck, card for card. Open one, playtest it, or start your own deck from it.",
};

// Precons are public and change once a night at most, so the list is read signed out (no cookies) and kept for an
// hour across visitors. A failed read throws, so it isn't cached and the next visit tries again.
const loadPrecons = unstable_cache(
  async () => {
    const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let last: unknown = null;
    // One retry: the first call after a quiet spell can time out while the free database warms up.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase.rpc("precon_list");
      if (!error) return (data ?? []) as PreconTile[];
      last = error;
    }
    throw last;
  },
  ["precon-list"],
  { revalidate: 3600, tags: ["precons"] },
);

export default async function PreconsPage() {
  try {
    return <PreconsView precons={await loadPrecons()} failed={false} />;
  } catch (e) {
    console.error("precon_list failed", e);
    return <PreconsView precons={[]} failed />;
  }
}
