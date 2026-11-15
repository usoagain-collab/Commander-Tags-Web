// Commander pages (V3): one public page per commander, readable signed out, so visitors and search engines have a
// way in. Shows the card, its Scryfall tags, the precons it leads and public decks built around it, with a button
// to start a deck with it. Public data only, cached for an hour. No migration.
import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { ArtCredit } from "@/components/art-credit";
import { ManaSymbol } from "@/components/mana-cost";
import { getCurrentUser } from "@/lib/supabase/user";
import { createDeck } from "@/app/decks/actions";
import { loadPublicDecks, type DeckTile } from "@/lib/browse/public-decks";
import type { CardSummary } from "@/lib/deck/model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const load = unstable_cache(
  async (id: string) => {
    const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: card, error } = await supabase.from("card_summaries").select("*").eq("oracle_id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!card || !(card as CardSummary).can_be_commander) return null;
    const [tagRes, decks] = await Promise.all([
      supabase.rpc("card_tags_for", { oracle_ids: [id] }),
      loadPublicDecks(supabase, { colors: "", bracket: null, precons: true, page: 1 }, [id]),
    ]);
    const slugs: string[] = (tagRes.data as { o?: Record<string, string[]> } | null)?.o?.[id] ?? [];
    const { data: tags } = slugs.length
      ? await supabase.from("tags").select("slug, label, size").eq("kind", "oracle").in("slug", slugs)
      : { data: [] as { slug: string; label: string; size: number }[] };
    return {
      card: card as CardSummary & { oracle_text?: string | null },
      // Rarer tags say more about a card, so they come first.
      tags: ((tags ?? []) as { slug: string; label: string; size: number }[]).sort((a, b) => a.size - b.size).slice(0, 30),
      precons: decks.decks.filter((d) => d.precon),
      decks: decks.decks.filter((d) => !d.precon),
      more: decks.more,
    };
  },
  ["commander-page"],
  { revalidate: 3600, tags: ["commanders"] },
);

async function get(id: string) {
  if (!UUID.test(id)) return null;
  return load(id.toLowerCase());
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const page = await get((await params).id).catch(() => null);
  if (!page) return { title: "Commander · Deck Genome" };
  return {
    title: `${page.card.name} Commander decks · Deck Genome`,
    description: `Precons and public decks led by ${page.card.name}, with its Scryfall tags. Start your own ${page.card.name} deck on Deck Genome.`,
  };
}

export default async function CommanderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [page, user] = await Promise.all([get(id), getCurrentUser()]);
  if (!page) notFound();
  const { card } = page;

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <div>
          {card.image_normal && <img src={card.image_normal} alt={card.name} className="w-full rounded-xl shadow" />}
          <ArtCredit artists={[card.artist]} className="mt-1 text-xs opacity-60" />
        </div>
        <div>
          <p className="text-sm opacity-70">Commander</p>
          <h1 className="display text-3xl">{card.name}</h1>
          <p className="mt-1 flex items-center gap-1 text-sm opacity-80">
            {(card.color_identity.length ? card.color_identity : ["C"]).map((c) => (
              <ManaSymbol key={c} symbol={c} size={16} />
            ))}
            <span className="ml-1">{card.type_line}</span>
          </p>

          <div className="mt-4">
            {user ? (
              <form action={createDeck}>
                <input type="hidden" name="name" value={`${card.name} deck`} />
                <input type="hidden" name="commander" value={card.oracle_id} />
                <button className="btn btn-gold min-h-11">✦ Build a deck with {card.name}</button>
              </form>
            ) : (
              <Link href={`/login?next=${encodeURIComponent(`/commanders/${card.oracle_id}`)}`} className="btn btn-gold min-h-11">
                ✦ Sign in to build with {card.name}
              </Link>
            )}
          </div>

          {page.tags.length > 0 && (
            <section className="mt-6">
              <h2 className="display text-lg">What it does</h2>
              <p className="text-sm opacity-70">Scryfall&rsquo;s tags for this card, the same ones Deck Genome sorts your deck by.</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {page.tags.map((t) => (
                  <li key={t.slug} className="rounded-full border border-foreground/20 px-2.5 py-1 text-xs">
                    {t.label}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <DeckSection title="Precons" empty="No precon leads with this commander." decks={page.precons} commanderId={card.oracle_id} />
      <DeckSection title="Public decks" empty="Nobody has shared a public deck with this commander yet." decks={page.decks} commanderId={card.oracle_id} />
      {page.more && (
        <p className="mt-3 text-sm">
          <Link href={`/browse?q=${encodeURIComponent(card.name)}`} className="underline">
            See more {card.name} decks
          </Link>
        </p>
      )}
    </main>
  );
}

/** "with Thrasios · " for a partner deck: the other commanders, by their short name. */
const partners = (d: DeckTile, commanderId: string) => {
  const others = d.commanders.filter((c) => c.oracle_id !== commanderId).map((c) => c.name.split(",")[0]);
  return others.length ? `with ${others.join(" & ")} · ` : "";
};

function DeckSection({ title, empty, decks, commanderId }: { title: string; empty: string; decks: DeckTile[]; commanderId: string }) {
  return (
    <section className="mt-8">
      <h2 className="display text-xl">{title}</h2>
      {decks.length === 0 ? (
        <p className="mt-1 text-sm opacity-70">{empty}</p>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((d) => (
            <li key={d.id}>
              <Link href={`/decks/${d.id}`} className="panel flex min-h-14 items-center justify-between gap-2 p-3 hover:border-gold">
                <span className="font-medium">{d.name}</span>
                <span className="shrink-0 text-xs opacity-70">
                  {partners(d, commanderId)}
                  {d.bracket ? `Bracket ${d.bracket}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
