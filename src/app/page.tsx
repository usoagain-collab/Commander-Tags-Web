import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { ArtCredit } from "@/components/art-credit";
import { GenomeStrip, type GenomeGroup } from "@/components/genome-strip";
import { roleColor } from "@/lib/tags/pretty";
import { recentPublicDecks } from "@/lib/browse/cached";
import { PublicDeckTile } from "@/components/public-deck-tile";
import type { DeckTile } from "@/lib/browse/public-decks";

// Design refresh (option E, Nov 20, 2026): the landing page from the design canvas. The hero shows an example deck's
// genome and role counts, so a visitor sees what the builder does before signing up.

const STEPS = [
  {
    n: "01 · Roles",
    color: roleColor("Ramp"),
    title: "See what your deck is missing",
    text: "Ramp, card draw, removal and more are counted as you build, each with a target you can move.",
  },
  {
    n: "02 · Themes",
    color: roleColor("Card advantage"),
    title: "Find the cards that fit",
    text: "Suggestions match your deck's themes and fill its gaps, including the gems nobody else is playing.",
  },
  {
    n: "03 · Play",
    color: roleColor("Recursion"),
    title: "Goldfish it, then share it",
    text: "Draw hands on a real table in your browser, then send friends a link to a deck that looks the part.",
  },
];

/** The example deck in the hero: a typical 100-card deck, two roles short. Illustration only, labeled as an example. */
const EXAMPLE: { name: string; have: number; target: number }[] = [
  { name: "Lands", have: 37, target: 37 },
  { name: "Ramp", have: 12, target: 10 },
  { name: "Card advantage", have: 8, target: 10 },
  { name: "Targeted removal", have: 5, target: 8 },
  { name: "Board wipes", have: 3, target: 3 },
  { name: "Recursion", have: 2, target: 2 },
];
const EXAMPLE_GENOME: GenomeGroup[] = [
  ...EXAMPLE.map((r) => ({ key: r.name, label: r.name, color: roleColor(r.name), count: r.have })),
  { key: "Protection", label: "Protection", color: roleColor("Protection"), count: 3 },
  { key: "other", label: "No role", color: "color-mix(in srgb, var(--foreground) 22%, transparent)", count: 30 },
];

/** Two real cards for the "by function" example, with the reason Suggest would give. */
const SAMPLE_PICKS = [
  { name: "Tatyova, Benthic Druid", role: "Card advantage", tags: ["landfall", "draw", "lifegain"] },
  { name: "Retreat to Coralhelm", role: "Ramp", tags: ["landfall", "untap", "tap down"] },
];

export default async function Home({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  // The two most-played commanders make the fanned cards, so the page changes as the format does.
  // Fresh public decks (Nov 21, 2026) sit right under the hero, so a visitor sees people building here. A failed
  // read only hides the row.
  const [{ data }, { data: picks }, recent] = await Promise.all([
    supabase
      .from("card_summaries")
      .select("oracle_id, name, image_art_crop, artist")
      .eq("can_be_commander", true)
      .not("image_art_crop", "is", null)
      .not("edhrec_rank", "is", null)
      .order("edhrec_rank")
      .limit(2),
    supabase
      .from("card_summaries")
      .select("name, image_normal")
      .in(
        "name",
        SAMPLE_PICKS.map((p) => p.name),
      ),
    recentPublicDecks().catch((e): DeckTile[] => {
      console.error("home: public decks failed", e);
      return [];
    }),
  ]);
  const art = (data ?? []) as { oracle_id: string; name: string; image_art_crop: string; artist: string | null }[];
  const pickImage = new Map(((picks ?? []) as { name: string; image_normal: string | null }[]).map((p) => [p.name, p.image_normal]));
  const start = user ? "/decks" : "/try";

  return (
    <main>
      {deleted && (
        <p role="status" className="border-b border-gold/30 bg-gold/10 px-4 py-3 text-center text-sm">
          Your account and everything in it have been deleted. Thanks for building with us.
        </p>
      )}

      <section className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-14 px-6 pb-20 pt-14 sm:pt-20">
        <div className="min-w-0 flex-[1_1_440px]">
          <p className="eyebrow !text-gold">Commander deck builder</p>
          <h1 className="display mt-4 text-balance text-5xl leading-[1.02] sm:text-7xl">
            Every deck has a genome. <em className="text-gold">Read yours.</em>
          </h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed opacity-80">
            Deck Genome reads what each card does, from Scryfall&apos;s tags, and shows your deck as roles and themes. Fill
            the gaps with cards that fit how your deck plays, not just what everyone else plays.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {/* Signed out, "Start building" opens the builder straight away (/try); signing in comes when they want to keep it. */}
            <Link href={start} className="btn btn-gold min-h-14 px-7 text-base">
              {user ? "Go to my decks" : "Start building, free"}
            </Link>
            <Link href="/precons" className="btn min-h-14 px-7 text-base">
              Open a precon
            </Link>
          </div>
          {!user && <p className="mt-4 text-sm opacity-65">Sign in with Discord, Google or email when you want to keep a deck.</p>}
        </div>

        <div className="relative min-w-0 flex-[1_1_480px] pt-14">
          {/* Two commanders fanned behind the example; their art carries its credit just below the panel. */}
          {art.map((c, i) => (
            <img
              key={c.oracle_id}
              src={c.image_art_crop}
              alt=""
              className={`absolute top-0 hidden aspect-[4/3] w-44 rounded-xl object-cover shadow-2xl shadow-black/60 sm:block ${
                i === 0 ? "right-40 -rotate-6 ring-2 ring-gold" : "right-6 rotate-[8deg]"
              }`}
            />
          ))}
          <div className="panel relative flex flex-col gap-5 p-6 shadow-2xl shadow-black/50">
            <div>
              <p className="eyebrow">Example deck · 100 cards</p>
              <p className="eyebrow mt-3">Genome · one stripe per card</p>
              <GenomeStrip groups={EXAMPLE_GENOME} height={52} className="mt-2" />
            </div>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {EXAMPLE.map((r) => (
                <div key={r.name}>
                  <div className="flex justify-between text-sm">
                    <span className="opacity-85">{r.name}</span>
                    <span className={`font-mono text-[13px] ${r.have < r.target ? "text-red-400" : "opacity-65"}`}>
                      {r.have}/{r.target}
                    </span>
                  </div>
                  <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-foreground/10">
                    <div className="h-full" style={{ width: `${Math.min(100, (r.have / r.target) * 100)}%`, background: roleColor(r.name) }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 text-sm">
              <span className="eyebrow !text-gold">Suggested</span>
              <span>
                Card advantage is 2 short. <strong>Tatyova, Benthic Druid</strong> draws on every land and shares 3 themes.
              </span>
            </p>
          </div>
          {art.length > 0 && <ArtCredit artists={art.map((c) => c.artist)} className="mt-2" />}
        </div>
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="fresh-decks" className="mx-auto max-w-[1280px] px-6 pb-16">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="eyebrow !text-gold">From the community</p>
              <h2 id="fresh-decks" className="display mt-2 text-3xl sm:text-4xl">
                Fresh decks
              </h2>
            </div>
            <Link href="/browse" className="btn min-h-11 px-5">
              Browse all decks →
            </Link>
          </div>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((d) => (
              <PublicDeckTile key={d.id} deck={d} showAge />
            ))}
          </ul>
        </section>
      )}

      <section className="border-y border-line bg-panel">
        <div className="mx-auto grid max-w-[1280px] gap-10 px-6 py-16 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.title}>
              <p className="font-mono text-[13px]" style={{ color: s.color }}>
                {s.n}
              </p>
              <h2 className="display mt-3 text-[1.85rem] leading-tight">{s.title}</h2>
              <p className="mt-3 leading-relaxed opacity-75">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-12 px-6 py-20">
        <div className="min-w-0 flex-[1_1_380px]">
          <p className="eyebrow !text-gold">By function, not popularity</p>
          <h2 className="display mt-4 text-4xl leading-tight sm:text-5xl">Find the card that does the job your deck needs.</h2>
          <p className="mt-5 max-w-[34rem] text-lg leading-relaxed opacity-75">
            Every suggestion says why: the role it fills and the themes it shares with your deck. Switch to Hidden gems
            for what fits but few people play, or set a budget cap.
          </p>
        </div>
        <div className="grid min-w-0 flex-[1_1_560px] gap-4 sm:grid-cols-2">
          {SAMPLE_PICKS.map((p) => (
            <div key={p.name} className="panel flex gap-4 p-4">
              {pickImage.get(p.name) ? (
                <img src={pickImage.get(p.name)!} alt={p.name} className="w-[96px] shrink-0 self-start rounded-[4.75%/3.5%]" />
              ) : (
                <span aria-hidden className="aspect-[63/88] w-[96px] shrink-0 rounded-lg bg-panel-raised" />
              )}
              <div className="flex min-w-0 flex-col gap-2">
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm opacity-80">
                  Fills <strong style={{ color: roleColor(p.role) }}>{p.role}</strong>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {p.tags.map((t) => (
                    <span key={t} className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[11px] opacity-85">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-6 px-6 py-16">
          <div>
            <h2 className="display text-4xl">Or start from a precon</h2>
            <p className="mt-2 text-lg opacity-75">Every official Commander deck back to 2011, ready to open and upgrade.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/precons" className="btn min-h-12 px-6">
              Browse precons
            </Link>
            <Link href="/browse" className="btn min-h-12 px-6">
              Browse public decks
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
