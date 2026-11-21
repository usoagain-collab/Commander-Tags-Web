// Browse public decks (V3): anyone, signed in or not, can find public decks by commander, colors and bracket.
// Precons have their own page, so they are left out unless asked for. Read signed out (no cookies) and kept for
// five minutes per search, like the precons list. No migration: public decks are already readable by anyone.
import Link from "next/link";
import { ManaSymbol } from "@/components/mana-cost";
import { BRACKETS } from "@/lib/brackets/rules";
import { browseHref, parseBrowseQuery } from "@/lib/browse/public-decks";
import { searchPublicDecks as search } from "@/lib/browse/cached";
import { PublicDeckTile } from "@/components/public-deck-tile";

export const metadata = {
  title: "Browse Commander decks · Deck Genome",
  description: "Find public Commander decks by commander, colors and bracket, and see how each one is built.",
};

export default async function BrowsePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = parseBrowseQuery(await searchParams);
  let result: Awaited<ReturnType<typeof search>> | null = null;
  try {
    result = await search(query);
  } catch (e) {
    console.error("browse failed", e);
  }

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6">
      <h1 className="display text-3xl">Browse decks</h1>
      <p className="mt-1 text-sm opacity-80">Public decks people have built here. Open one to see its role bars, play it, or copy it to your decks.</p>

      <form method="get" action="/browse" className="panel mt-4 flex flex-wrap items-end gap-3 p-3">
        <label className="flex min-w-0 flex-1 flex-col text-sm">
          <span className="opacity-80">Commander</span>
          <input
            name="q"
            defaultValue={query.q}
            placeholder="Any commander, e.g. Atraxa"
            className="mt-1 min-h-11 rounded-md border border-foreground/20 bg-background px-3"
          />
        </label>
        <fieldset className="text-sm">
          <legend className="opacity-80">Colors (exactly)</legend>
          <div className="mt-1 flex gap-1">
            {[..."WUBRGC"].map((c) => (
              <label key={c} className="flex min-h-11 cursor-pointer items-center gap-1 rounded-md border border-foreground/20 px-2">
                <input type="checkbox" name="colors" value={c} defaultChecked={c === "C" ? query.colors === "C" : query.colors.includes(c)} className="accent-gold" />
                <ManaSymbol symbol={c} size={18} />
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col text-sm">
          <span className="opacity-80">Bracket</span>
          <select name="bracket" defaultValue={query.bracket ?? ""} className="mt-1 min-h-11 rounded-md border border-foreground/20 bg-background px-2">
            <option value="">Any</option>
            {BRACKETS.map((b) => (
              <option key={b.n} value={b.n}>
                {b.n}: {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="precons" value="1" defaultChecked={query.precons} className="h-4 w-4 accent-gold" />
          Include precons
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="help" value="1" defaultChecked={query.help} className="h-4 w-4 accent-gold" />
          Wants feedback
        </label>
        <button className="btn btn-gold min-h-11">Search</button>
      </form>

      {!result ? (
        <p className="mt-6 text-sm text-red-400">Couldn&rsquo;t load decks just now. Try again in a moment.</p>
      ) : result.decks.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">
          {query.help ? "No public decks are asking for feedback right now." : "No public decks match."}{" "}
          {query.q || query.colors || query.bracket || query.help ? (
            <Link href="/browse" className="underline">
              Clear the filters
            </Link>
          ) : null}
        </p>
      ) : (
        <>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {result.decks.map((d) => (
              <PublicDeckTile key={d.id} deck={d} showAge />
            ))}
          </ul>
          <nav aria-label="Pages" className="mt-6 flex justify-between text-sm">
            {query.page > 1 ? (
              <Link className="btn min-h-11" href={browseHref(query, { page: query.page - 1 })}>
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            {result.more && (
              <Link className="btn min-h-11" href={browseHref(query, { page: query.page + 1 })}>
                Older →
              </Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}
