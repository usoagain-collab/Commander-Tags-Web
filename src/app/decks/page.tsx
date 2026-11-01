import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { createDeck } from "./actions";
import { DeckRow, type DeckTile } from "./deck-row";
import { DropHint } from "./drop-hint";
import { BRACKETS } from "@/lib/brackets/rules";

export const metadata = { title: "My decks · Commander Tags" };

type Summary = { oracle_id: string; name: string; image_art_crop: string | null; color_identity: string[] };

export default async function DecksPage() {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);

  // RLS allows public decks plus the user's own; this page shows only their own.
  const { data: decks, error } = await supabase
    .from("decks")
    .select("id, name, updated_at, deck_cards(quantity, board, oracle_id)")
    .eq("owner_id", user!.id)
    .order("updated_at", { ascending: false });

  type Row = { quantity: number; board: string; oracle_id: string };
  const rowsOf = (d: { deck_cards?: unknown }) => (d.deck_cards ?? []) as Row[];
  // Batches of 100: too many ids in one request make its URL too long.
  const commanderIds = [...new Set((decks ?? []).flatMap((d) => rowsOf(d).filter((r) => r.board === "commander").map((r) => r.oracle_id)))];
  const commanders = new Map<string, Summary>();
  for (let i = 0; i < commanderIds.length; i += 100) {
    const { data } = await supabase
      .from("card_summaries")
      .select("oracle_id, name, image_art_crop, color_identity")
      .in("oracle_id", commanderIds.slice(i, i + 100));
    for (const c of (data ?? []) as Summary[]) commanders.set(c.oracle_id, c);
  }

  const rows: DeckTile[] = (decks ?? []).map((d) => {
    const cards = rowsOf(d);
    const own = cards.filter((r) => r.board === "commander").flatMap((r) => commanders.get(r.oracle_id) ?? []);
    return {
      id: d.id as string,
      name: d.name as string,
      updated_at: d.updated_at as string,
      card_count: cards.filter((r) => r.board === "commander" || r.board === "main").reduce((n, c) => n + c.quantity, 0),
      art: own[0]?.image_art_crop ?? null,
      commander: own.map((c) => c.name).join(" & ") || null,
      identity: [...new Set(own.flatMap((c) => c.color_identity))],
    };
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <form action={createDeck} className="panel relative overflow-hidden p-5 sm:p-6">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-gold/15 to-transparent" />
        <div className="relative">
          <h1 className="display text-2xl sm:text-3xl">{rows.length ? "What are you building next?" : "Build your first deck"}</h1>
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              name="name"
              placeholder="Name your deck"
              aria-label="Deck name"
              maxLength={120}
              className="min-h-11 min-w-48 flex-1 rounded-lg border border-foreground/20 bg-background/60 px-3"
            />
            <label className="flex items-center gap-2 text-sm">
              <span className="opacity-80">Bracket</span>
              <select
                name="bracket"
                defaultValue="3"
                aria-label="Target bracket"
                title="The bracket you're building for. You can change it later."
                className="min-h-11 rounded-lg border border-foreground/20 bg-background px-2"
              >
                {BRACKETS.map((b) => (
                  <option key={b.n} value={b.n}>
                    {b.n} {b.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-gold min-h-11 px-5">New deck</button>
          </div>
        </div>
      </form>

      {error && <p className="mt-6 text-sm text-red-400">Couldn&apos;t load your decks: {error.message}</p>}

      {rows.length > 0 && (
        <>
          <div className="mt-8 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display text-xl">My decks</h2>
            <DropHint />
          </div>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((d) => (
              <DeckRow key={d.id} deck={d} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
