// Download my data: everything the signed-in user made, as one plain text file (formatExport).
// Reads run as the user, so row-level security limits them to their own rows.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { formatExport, type ExportCardRow, type ExportDeck } from "@/lib/account/export";

type Info = { set?: string; number?: string } | null;
type Named = { name: string } | null;
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// PostgREST returns at most 1,000 rows per request, so read in pages.
async function all<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const printed = (info: Info): Pick<ExportCardRow, "set" | "number"> => ({ set: info?.set ?? null, number: info?.number ?? null });

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims?.sub;
  if (typeof uid !== "string") return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  try {
    const [{ data: auth }, { data: profile }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("profiles").select("display_name, created_at").eq("id", uid).single(),
    ]);
    const decks = await all<{ id: string; name: string; visibility: string; target_bracket: number | null; created_at: string; updated_at: string }>((a, b) =>
      supabase.from("decks").select("id, name, visibility, target_bracket, created_at, updated_at").eq("owner_id", uid).order("id").range(a, b),
    );
    const ids = decks.map((d) => d.id);
    type Row = { deck_id: string; board: string; quantity: number; foil: boolean; printing_info: Info; cards: Named };
    const rows: Row[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      rows.push(
        ...(await all<Row>((a, b) =>
          supabase.from("deck_cards").select("deck_id, board, quantity, foil, printing_info, cards(name)").in("deck_id", chunk).order("deck_id").order("oracle_id").order("board").range(a, b) as unknown as Page<Row>,
        )),
      );
    }
    const tags = await all<{ name: string; deck_id: string | null; user_tag_cards: { cards: Named }[] }>((a, b) =>
      supabase.from("user_tags").select("name, deck_id, user_tag_cards(cards(name))").eq("owner_id", uid).order("id").range(a, b) as unknown as Page<{ name: string; deck_id: string | null; user_tag_cards: { cards: Named }[] }>,
    );
    const wish = await all<{ quantity: number; foil: boolean; note: string | null; cards: Named }>((a, b) =>
      supabase.from("wishlist").select("quantity, foil, note, cards(name)").eq("owner_id", uid).order("oracle_id").range(a, b) as unknown as Page<{ quantity: number; foil: boolean; note: string | null; cards: Named }>,
    );
    const owned = await all<{ quantity: number; finish: string; printing_info: Info; cards: Named }>((a, b) =>
      supabase.from("collection_cards").select("quantity, finish, printing_info, cards(name)").eq("owner_id", uid).order("id").range(a, b) as unknown as Page<{ quantity: number; finish: string; printing_info: Info; cards: Named }>,
    );

    const deckName = new Map(decks.map((d) => [d.id, d.name]));
    const byDeck = new Map<string, ExportDeck>(
      decks.map((d) => [d.id, { name: d.name, visibility: d.visibility, bracket: d.target_bracket, created: d.created_at, updated: d.updated_at, boards: {} }]),
    );
    for (const r of rows) {
      const deck = byDeck.get(r.deck_id);
      const board = r.board as keyof ExportDeck["boards"];
      if (!deck) continue;
      (deck.boards[board] ??= []).push({ quantity: r.quantity, name: r.cards?.name ?? "Unknown card", foil: r.foil, ...printed(r.printing_info) });
    }

    const text = formatExport({
      name: profile?.display_name ?? null,
      email: auth.user?.email ?? null,
      joined: profile?.created_at ?? auth.user?.created_at ?? null,
      decks: [...byDeck.values()],
      myTags: tags.map((t) => ({
        name: t.name,
        scope: t.deck_id ? `only in ${deckName.get(t.deck_id) ?? "a deck"}` : "all decks",
        cards: t.user_tag_cards.map((c) => c.cards?.name ?? "Unknown card"),
      })),
      wishlist: wish.map((w) => ({ quantity: w.quantity, name: w.cards?.name ?? "Unknown card", foil: w.foil, note: w.note })),
      collection: owned.map((c) => ({
        quantity: c.quantity,
        name: c.cards?.name ?? "Unknown card",
        foil: c.finish !== "nonfoil",
        etched: c.finish === "etched",
        ...printed(c.printing_info),
      })),
    });
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="deck-genome-${date}.txt"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't read your data." }, { status: 500 });
  }
}
