// One playgroup (V3, migration 0062): members, its invite link, logging games, standings and the game history.
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { readPlaygroup } from "@/lib/playgroups/playgroups";
import { PlaygroupView } from "./playgroup-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata() {
  return { title: "Playgroup · Deck Genome" };
}

export default async function PlaygroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  const [{ data, error }, { data: decks }] = await Promise.all([
    supabase.rpc("playgroup_view", { p_id: id }),
    supabase.from("decks").select("id, name").eq("owner_id", user!.id).order("updated_at", { ascending: false }).limit(200),
  ]);
  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8 text-sm opacity-80">
        <p>Playgroups aren&apos;t switched on yet.</p>
      </main>
    );
  }
  const group = readPlaygroup(data);
  if (!group) notFound();
  return <PlaygroupView initial={group} myDecks={(decks ?? []) as { id: string; name: string }[]} />;
}
