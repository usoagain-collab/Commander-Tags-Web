// Opening a co-build invite link (V3, migration 0064): shows the deck and whose it is, and a button to start
// building it with them. Signed-out visitors are sent to sign in first and come back here.
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { builderName, readCobuildInvite } from "@/lib/deck/cobuild";
import { joinCobuild } from "../../actions";

export const metadata = { title: "Build a deck together · Deck Genome" };

export default async function CobuildInvitePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ code }, { error: problem }, supabase] = await Promise.all([params, searchParams, createClient()]);
  const { data, error } = await supabase.rpc("cobuild_invite", { p_code: code.slice(0, 64) });
  const invite = error ? null : readCobuildInvite(data);
  if (invite?.joined) redirect(`/decks/${invite.deck_id}`);

  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      {error ? (
        <p className="opacity-80">Building together isn&apos;t switched on yet.</p>
      ) : !invite ? (
        <>
          <h1 className="display text-3xl">This invite link doesn&apos;t work</h1>
          <p className="mt-3 opacity-85">It may have been turned off or replaced with a new one. Ask whoever sent it for the new link.</p>
          <Link href="/decks" className="btn mt-6 min-h-11 px-5">
            My decks
          </Link>
        </>
      ) : (
        <>
          <p className="eyebrow">Build a deck together</p>
          <h1 className="display mt-2 text-3xl">{invite.deck_name}</h1>
          <p className="mt-3 opacity-85">
            {builderName(invite.owner)} invited you to build this deck with them. You&apos;ll be able to add, cut and move its cards; its name, sharing and
            settings stay theirs. They&apos;ll see your name on the deck.
          </p>
          <form action={joinCobuild} className="mt-6">
            <input type="hidden" name="code" value={code} />
            <button className="btn btn-gold min-h-11 px-5">Start building</button>
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
