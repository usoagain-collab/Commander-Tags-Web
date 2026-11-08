import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { fetchSummaries } from "@/lib/deck/fetch-summaries";
import { WishlistView, type WishRow } from "./wishlist-view";

export const metadata = { title: "Wish list · Deck Genome" };

export default async function WishlistPage() {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) redirect("/login?next=/wishlist");
  const { data, error } = await supabase.from("wishlist").select("oracle_id, quantity, foil, note, added_at").order("added_at", { ascending: false });
  const rows = (data ?? []) as Omit<WishRow, "card">[];
  const cards = rows.length ? await fetchSummaries(supabase, rows.map((r) => r.oracle_id)) : [];
  const byId = new Map(cards.map((c) => [c.oracle_id, c]));
  return (
    <WishlistView
      userId={user.id}
      initial={rows.flatMap((r) => (byId.has(r.oracle_id) ? [{ ...r, card: byId.get(r.oracle_id)! }] : []))}
      loadError={error?.message ?? null}
    />
  );
}
