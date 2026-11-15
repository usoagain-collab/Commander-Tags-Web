// Opening a playgroup invite link (V3, migration 0062): shows the playgroup and a Join button.
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { joinPlaygroup } from "../../actions";

export const metadata = { title: "Join a playgroup · Deck Genome" };

export default async function JoinPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ code }, { error: problem }, supabase] = await Promise.all([params, searchParams, createClient()]);
  const { data, error } = await supabase.rpc("playgroup_invite", { p_code: code.slice(0, 64) });
  const invite = !error && data && typeof data === "object" ? (data as { id: string; name: string; members: number; joined: boolean }) : null;
  if (invite?.joined) redirect(`/playgroups/${invite.id}`);

  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      {error ? (
        <p className="opacity-80">Playgroups aren&apos;t switched on yet.</p>
      ) : !invite ? (
        <>
          <h1 className="display text-3xl">This invite link doesn&apos;t work</h1>
          <p className="mt-3 opacity-85">It may have been replaced with a new one. Ask whoever sent it for the new link.</p>
          <Link href="/playgroups" className="btn mt-6 min-h-11 px-5">
            Your playgroups
          </Link>
        </>
      ) : (
        <>
          <p className="eyebrow">Playgroup invite</p>
          <h1 className="display mt-2 text-3xl">{invite.name}</h1>
          <p className="mt-3 opacity-85">
            {invite.members} {invite.members === 1 ? "player" : "players"} so far. Members see each other&apos;s names and the games logged together.
          </p>
          <form action={joinPlaygroup} className="mt-6">
            <input type="hidden" name="code" value={code} />
            <button className="btn btn-gold min-h-11 px-5">Join {invite.name}</button>
          </form>
          {problem && (
            <p role="alert" className="mt-3 text-sm text-red-400">
              {problem.slice(0, 200)}
            </p>
          )}
        </>
      )}
    </main>
  );
}
