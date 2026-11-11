import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { ArtCredit } from "@/components/art-credit";

const FEATURES = [
  {
    title: "See what your deck is missing",
    text: "Ramp, card draw, removal and more are counted for you as you build, with a target for each.",
  },
  {
    title: "Suggestions by what cards do",
    text: "Picks that fit your deck's themes and fill its gaps, including the gems nobody else is playing.",
  },
  {
    title: "Goldfish it, then show it off",
    text: "Draw hands on a real table in your browser, then send friends a link to a deck that looks the part.",
  },
];

export default async function Home({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  // The most-played commanders make the backdrop, so it changes as the format does.
  const { data } = await supabase
    .from("card_summaries")
    .select("oracle_id, name, image_art_crop, artist")
    .eq("can_be_commander", true)
    .not("image_art_crop", "is", null)
    .not("edhrec_rank", "is", null)
    .order("edhrec_rank")
    .limit(8);
  const art = (data ?? []) as { oracle_id: string; name: string; image_art_crop: string; artist: string | null }[];

  return (
    <main>
      {deleted && (
        <p role="status" className="border-b border-gold/30 bg-gold/10 px-4 py-3 text-center text-sm">
          Your account and everything in it have been deleted. Thanks for building with us.
        </p>
      )}
      <section className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 grid grid-cols-2 opacity-60 md:grid-cols-4">
          {art.map((c) => (
            <img key={c.oracle_id} src={c.image_art_crop} alt="" className="h-full min-h-40 w-full object-cover" />
          ))}
        </div>
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/80 to-background" />
        <div className="relative mx-auto max-w-3xl px-6 py-20 text-center sm:py-28">
          <p className="eyebrow">A Commander deck builder</p>
          <h1 className="display mt-3 text-balance text-4xl leading-tight sm:text-6xl">Build your next deck around what cards do.</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg opacity-85">
            New set out? Find every card that fits your commander, keep the deck balanced, and share something worth
            bragging about.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {/* Signed out, go straight to sign-in rather than through the /decks redirect, which left the button looking dead. */}
            <Link href={user ? "/decks" : "/login?next=/decks&mode=signup"} className="btn btn-gold min-h-12 px-6 text-base">
              {user ? "Go to my decks" : "Start building"}
            </Link>
            <Link href="/precons" className="btn min-h-12 px-6 text-base">
              Explore precons
            </Link>
          </div>
        </div>
        <ArtCredit artists={art.map((c) => c.artist)} className="relative mx-auto max-w-3xl px-6 pb-4 text-center" />
      </section>
      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-16 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="panel p-5">
            <h2 className="display text-lg">{f.title}</h2>
            <p className="mt-2 text-sm opacity-80">{f.text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
