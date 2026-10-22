import { createClient } from "@/lib/supabase/server";
import { createDeck } from "./actions";
import { DeckRow } from "./deck-row";
import { DropHint } from "./drop-hint";
import { BRACKETS } from "@/lib/brackets/rules";

export const metadata = { title: "My decks · Commander Tags" };

export default async function DecksPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // RLS allows public decks plus the user's own; this page shows only their own.
  const { data: decks, error } = await supabase
    .from("decks")
    .select("id, name, updated_at, deck_cards(quantity)")
    .eq("owner_id", user!.id)
    .order("updated_at", { ascending: false });

  const rows = (decks ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    updated_at: d.updated_at as string,
    card_count: ((d.deck_cards ?? []) as { quantity: number }[]).reduce((n, c) => n + c.quantity, 0),
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">My decks</h1>

      <form action={createDeck} className="mt-6 flex flex-wrap gap-2">
        <input
          name="name"
          placeholder="New deck name"
          maxLength={120}
          className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-3 py-2"
        />
        <label className="flex items-center gap-1 text-sm">
          <span className="sr-only sm:not-sr-only sm:opacity-70">Bracket</span>
          <select
            name="bracket"
            defaultValue="3"
            aria-label="Target bracket"
            title="The bracket you're building for. You can change it later."
            className="min-h-10 rounded-md border border-foreground/20 bg-background px-2"
          >
            {BRACKETS.map((b) => (
              <option key={b.n} value={b.n}>
                {b.n} {b.name}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md bg-foreground px-4 py-2 font-medium text-background">New deck</button>
      </form>

      {error && <p className="mt-6 text-sm text-red-600">Couldn&apos;t load your decks: {error.message}</p>}
      {rows.length > 0 && <DropHint />}

      {rows.length === 0 && !error ? (
        <p className="mt-10 opacity-70">No decks yet. Name one above to start.</p>
      ) : (
        <ul className="mt-4 divide-y divide-foreground/10">
          {rows.map((d) => (
            <DeckRow key={d.id} deck={d} />
          ))}
        </ul>
      )}
    </main>
  );
}
