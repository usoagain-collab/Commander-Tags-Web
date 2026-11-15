// Playgroups (V3, migration 0062): your playgroups, and a box to make one. Friends join with an invite link.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { readMyPlaygroups, PLAYGROUP_NAME_MAX } from "@/lib/playgroups/playgroups";
import { createPlaygroup } from "./actions";

export const metadata = { title: "Playgroups · Deck Genome" };

export default async function PlaygroupsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [supabase, params] = await Promise.all([createClient(), searchParams]);
  const { data, error } = await supabase.rpc("my_playgroups");
  const groups = readMyPlaygroups(data);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="display text-3xl">Playgroups</h1>
      <p className="mt-1 text-sm opacity-80">The people you play with. Log your games together and see who wins with which deck.</p>

      {error ? (
        <p className="mt-6 text-sm opacity-80">Playgroups aren&apos;t switched on yet.</p>
      ) : (
        <>
          <form action={createPlaygroup} className="panel mt-6 flex flex-wrap items-end gap-3 p-3">
            <label className="flex min-w-0 flex-1 flex-col text-sm">
              <span className="opacity-80">New playgroup</span>
              <input
                name="name"
                required
                maxLength={PLAYGROUP_NAME_MAX}
                placeholder="e.g. Friday night at the shop"
                className="mt-1 min-h-11 rounded-md border border-foreground/20 bg-background px-3"
              />
            </label>
            <button className="btn btn-gold min-h-11 px-4">Make it</button>
          </form>
          {params.error && (
            <p role="alert" className="mt-2 text-sm text-red-400">
              {params.error.slice(0, 200)}
            </p>
          )}

          {groups.length === 0 ? (
            <p className="mt-6 text-sm opacity-80">
              You&apos;re not in a playgroup yet. Make one and send your friends its invite link, or open a link a friend sent you.
            </p>
          ) : (
            <ul className="mt-6 space-y-3">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link href={`/playgroups/${g.id}`} className="panel block p-4 hover:opacity-90">
                    <p className="font-semibold">{g.name}</p>
                    <p className="mt-1 text-sm opacity-75">
                      {g.members} {g.members === 1 ? "player" : "players"} · {g.games} {g.games === 1 ? "game" : "games"}
                      {g.last_played && ` · last played ${g.last_played}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
