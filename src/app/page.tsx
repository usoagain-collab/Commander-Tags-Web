import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { Layers, Sparkles, Swords } from "lucide-react";
import { roleColor } from "@/lib/tags/pretty";
import { recentPublicDecks } from "@/lib/browse/cached";
import { PublicDeckTile } from "@/components/public-deck-tile";
import type { DeckTile } from "@/lib/browse/public-decks";

// Redesign demo (Nov 27, 2026, stacked UI skills): the hero is the example deck's genome itself, drawn wide, with each
// role read out under it. Color only ever means a role; the one accent marks what to do next.

const STEPS = [
  {
    icon: Layers,
    color: roleColor("Ramp"),
    title: "See what your deck is missing",
    text: "Ramp, card draw, removal and more are counted as you build, each with a target you can move.",
  },
  {
    icon: Sparkles,
    color: roleColor("Card advantage"),
    title: "Find the cards that fit",
    text: "Suggestions match your deck's themes and fill its gaps, including the gems nobody else is playing.",
  },
  {
    icon: Swords,
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
/** Cards in the example that fill no role (the deck's theme cards). */
const EXAMPLE_OTHER = 33;

/**
 * Two real cards for the "by function" example, with the reason Suggest would give. Looked up by oracle id, which is
 * indexed. cards has no index on the plain name, so the name lookup read the whole table (5-10 s, Nov 21, 2026) and
 * signed-out visitors hit their 3 s cutoff and got blank boxes.
 */
const SAMPLE_PICKS = [
  { id: "0715e860-3b3b-4331-9718-207973e94fee", name: "Tatyova, Benthic Druid", role: "Card advantage", tags: ["landfall", "draw", "lifegain"] },
  { id: "c450f6b7-bb2a-4b8c-aec7-d27555137b63", name: "Retreat to Coralhelm", role: "Ramp", tags: ["landfall", "untap", "tap down"] },
];

export default async function Home({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  // Fresh public decks (Nov 21, 2026) sit right under the hero, so a visitor sees people building here. A failed
  // read only hides the row.
  const [{ data: picks }, recent] = await Promise.all([
    supabase
      .from("card_summaries")
      .select("oracle_id, image_normal")
      .in(
        "oracle_id",
        SAMPLE_PICKS.map((p) => p.id),
      ),
    recentPublicDecks().catch((e): DeckTile[] => {
      console.error("home: public decks failed", e);
      return [];
    }),
  ]);
  const pickImage = new Map(((picks ?? []) as { oracle_id: string; image_normal: string | null }[]).map((p) => [p.oracle_id, p.image_normal]));
  const start = user ? "/decks" : "/try";
  const stripes = [
    ...EXAMPLE.flatMap((r) => Array.from({ length: r.have }, () => roleColor(r.name))),
    ...Array.from({ length: 3 }, () => roleColor("Protection")),
    ...Array.from({ length: EXAMPLE_OTHER }, () => "color-mix(in srgb, var(--foreground) 16%, transparent)"),
  ].slice(0, 100);
  const tatyova = pickImage.get(SAMPLE_PICKS[0].id);

  return (
    <main>
      {deleted && (
        <p role="status" className="border-b border-gold/30 bg-gold/10 px-4 py-3 text-center text-sm">
          Your account and everything in it have been deleted. Thanks for building with us.
        </p>
      )}

      <section className="mx-auto max-w-[1280px] px-5 pb-16 pt-12 sm:px-6 sm:pt-20">
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
          <div className="min-w-0 flex-[1_1_560px]">
            <h1 className="display text-balance text-[2.75rem] leading-[0.98] sm:text-[5.25rem]">Build your Commander deck by what each card does.</h1>
          </div>
          <div className="min-w-0 flex-[1_1_340px] pb-2">
            <p className="max-w-[30rem] text-lg leading-relaxed text-foreground/80">
              Deck Genome counts ramp, card draw, removal and every other job as you build, then suggests cards that fit
              how your deck plays.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {/* Signed out, "Start building" opens the builder straight away (/try); signing in comes when they want to keep it. */}
              <Link href={start} className="btn btn-gold min-h-13 px-7 text-base">
                {user ? "Go to my decks" : "Start building, free"}
              </Link>
              <Link href="/precons" className="btn min-h-13 px-7 text-base">
                Open a precon
              </Link>
            </div>
            {!user && <p className="mt-3 text-sm text-foreground/65">No account needed until you want to keep a deck.</p>}
          </div>
        </div>

        {/* The one bold thing on the page: a real-looking deck, one stripe per card, sorted by role. */}
        <figure className="mt-14">
          <p className="mb-3 text-sm text-foreground/70">An example 100-card deck, one stripe per card, sorted by role.</p>
          <div aria-hidden className="genome-reveal flex h-24 gap-[2px] sm:h-36">
            {stripes.map((c, i) => (
              <span key={i} className="h-full flex-1 rounded-[2px]" style={{ background: c }} />
            ))}
          </div>
          <figcaption className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
            {EXAMPLE.map((r) => {
              const short = r.target - r.have;
              return (
                <div key={r.name} className="min-w-0">
                  <p className="flex items-center gap-2 text-sm text-foreground/80">
                    <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: roleColor(r.name) }} />
                    {r.name}
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {r.have}
                    <span className="text-base font-normal text-foreground/60"> of {r.target}</span>
                  </p>
                  {short > 0 && <p className="text-sm font-semibold text-gold">{short} short</p>}
                </div>
              );
            })}
          </figcaption>
        </figure>

        <div className="mt-10 flex max-w-3xl items-center gap-5 rounded-2xl border border-gold/40 bg-gold/[0.07] p-4 sm:p-5">
          {tatyova && <img src={tatyova} alt="Tatyova, Benthic Druid" width={488} height={680} className="h-auto w-20 shrink-0 rounded-[4.75%/3.5%] shadow-lg sm:w-24" />}
          <p className="leading-relaxed">
            <span className="font-bold text-gold">Suggested for this deck.</span> Card advantage is 2 short.{" "}
            <strong>Tatyova, Benthic Druid</strong> draws a card on every land you play and shares 3 of the deck&apos;s
            themes.
          </p>
        </div>
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="fresh-decks" className="mx-auto max-w-[1280px] px-5 pb-16 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="fresh-decks" className="display text-3xl sm:text-4xl">
              Decks people are building
            </h2>
            <Link href="/browse" className="btn min-h-11 px-5">
              Browse all decks
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
        <div className="mx-auto max-w-[1280px] px-5 py-16 sm:px-6">
          <h2 className="display text-3xl sm:text-4xl">How a deck comes together</h2>
          <ol className="mt-10 grid gap-10 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.title}>
                <s.icon aria-hidden size={28} strokeWidth={1.75} style={{ color: s.color }} />
                <h3 className="display mt-4 text-2xl leading-tight">{s.title}</h3>
                <p className="mt-2 max-w-[34ch] leading-relaxed text-foreground/75">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-12 px-5 py-20 sm:px-6">
        <div className="min-w-0 flex-[1_1_380px]">
          <h2 className="display text-4xl leading-[1.02] sm:text-5xl">Suggestions by function, not popularity.</h2>
          <p className="mt-5 max-w-[34rem] text-lg leading-relaxed text-foreground/75">
            Every suggestion says why: the role it fills and the themes it shares with your deck. Switch to Hidden gems
            for what fits but few people play, or set a budget cap.
          </p>
        </div>
        <ul className="grid min-w-0 flex-[1_1_560px] gap-4 sm:grid-cols-2">
          {SAMPLE_PICKS.map((p) => (
            <li key={p.name} className="panel flex gap-4 p-4">
              {pickImage.get(p.id) ? (
                <img src={pickImage.get(p.id)!} alt={p.name} width={488} height={680} loading="lazy" className="h-auto w-[96px] shrink-0 self-start rounded-[4.75%/3.5%]" />
              ) : (
                <span aria-hidden className="aspect-[63/88] w-[96px] shrink-0 rounded-lg bg-panel-raised" />
              )}
              <div className="flex min-w-0 flex-col gap-2">
                <p className="font-bold">{p.name}</p>
                <p className="text-sm text-foreground/80">
                  Fills <strong style={{ color: roleColor(p.role) }}>{p.role}</strong>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {p.tags.map((t) => (
                    <span key={t} className="rounded-full bg-foreground/10 px-2.5 py-0.5 text-[13px] text-foreground/85">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-6 px-5 py-16 sm:px-6">
          <div>
            <h2 className="display text-4xl">Or start from a precon</h2>
            <p className="mt-2 text-lg text-foreground/75">Every official Commander deck back to 2011, ready to open and upgrade.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/precons" className="btn min-h-12 px-6">
              Browse precons
            </Link>
            {/* Fresh decks above already links to Browse; say it once (David, Nov 21, 2026). */}
            {recent.length === 0 && (
              <Link href="/browse" className="btn min-h-12 px-6">
                Browse public decks
              </Link>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
