import { createClient } from "@/lib/supabase/server";
import { PreconsView, type PreconTile } from "./precons-view";

export const metadata = {
  title: "Commander precons · Deck Genome",
  description: "Every Commander precon deck, card for card. Open one, playtest it, or start your own deck from it.",
};
// The list changes once a night at most.
export const revalidate = 3600;

export default async function PreconsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("precon_list");
  return <PreconsView precons={(data ?? []) as PreconTile[]} error={error?.message ?? null} />;
}
