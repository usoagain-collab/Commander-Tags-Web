import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { createDeck } from "./actions";
import type { DeckTile } from "./deck-row";
import { DeckList } from "./deck-list";
import { DropHint } from "./drop-hint";
import { BRACKETS } from "@/lib/brackets/rules";
import { printingImage } from "@/lib/deck/printing";
import { byFolderName, folderCounts, inFolder, pickFolder, type Folder } from "@/lib/decks/folders";
import { FolderBar } from "./folder-bar";
import { readCobuildDecks } from "@/lib/deck/cobuild";

export const metadata = { title: "My decks · Deck Genome" };

type Summary = { oracle_id: string; name: string; image_art_crop: string | null; artist: string | null; color_identity: string[] };

export default async function DecksPage({ searchParams }: { searchParams: Promise<{ folder?: string | string[] }> }) {
  const [supabase, user, params] = await Promise.all([createClient(), getCurrentUser(), searchParams]);

  // RLS allows public decks plus the user's own; this page shows only their own.
  const { data: decks, error } = await supabase
    .from("decks")
    .select("id, name, updated_at, visibility, cover_oracle_id, deck_cards(quantity, board, oracle_id, printing_id, printing_info)")
    .eq("owner_id", user!.id)
    .order("updated_at", { ascending: false });

  // Folders (V3, migration 0056). Read apart from the decks, so the page still works before that migration has run:
  // the folder reads fail and no folder controls show.
  const [folderRes, placeRes] = await Promise.all([
    supabase.from("deck_folders").select("id, name"),
    supabase.from("decks").select("id, folder_id").eq("owner_id", user!.id),
  ]);
  const foldersReady = !folderRes.error && !placeRes.error;
  const folders: Folder[] = foldersReady ? byFolderName((folderRes.data ?? []) as Folder[]) : [];
  const folderOf = new Map(foldersReady ? ((placeRes.data ?? []) as { id: string; folder_id: string | null }[]).map((d) => [d.id, d.folder_id]) : []);
  const folderParam = Array.isArray(params.folder) ? params.folder[0] : params.folder;
  const pick = pickFolder(folderParam, folders);

  // Decks you build with a friend (V3 co-build, migration 0064). Before that migration this fails and nothing shows.
  const { data: cobuildRaw } = await supabase.rpc("my_cobuild_decks");
  const together = readCobuildDecks(cobuildRaw);

  // Your default printings, for the art on each tile.
  const { data: defaults } = await supabase.from("preferred_printings").select("oracle_id, printing_id, printing_info");
  const defaultOf = new Map((defaults ?? []).map((p) => [p.oracle_id as string, p.printing_id as string]));
  const defaultArtistOf = new Map((defaults ?? []).map((p) => [p.oracle_id as string, ((p.printing_info as { artist?: string | null } | null)?.artist ?? null)]));

  type Row = { quantity: number; board: string; oracle_id: string; printing_id: string | null; printing_info?: { artist?: string | null } | null };
  const rowsOf = (d: { deck_cards?: unknown }) => (d.deck_cards ?? []) as Row[];
  // Batches of 100: too many ids in one request make its URL too long.
  const commanderIds = [...new Set((decks ?? []).flatMap((d) => rowsOf(d).filter((r) => r.board === "commander" || r.oracle_id === d.cover_oracle_id).map((r) => r.oracle_id)))];
  const commanders = new Map<string, Summary>();
  for (let i = 0; i < commanderIds.length; i += 100) {
    const { data } = await supabase
      .from("card_summaries")
      .select("oracle_id, name, image_art_crop, artist, color_identity")
      .in("oracle_id", commanderIds.slice(i, i + 100));
    for (const c of (data ?? []) as Summary[]) commanders.set(c.oracle_id, c);
  }

  const rows: DeckTile[] = (decks ?? []).map((d) => {
    const cards = rowsOf(d);
    const own = cards.filter((r) => r.board === "commander").flatMap((r) => commanders.get(r.oracle_id) ?? []);
    const cover = cards.find((r) => r.oracle_id === d.cover_oracle_id);
    const shownPrinting = (r: Row) => r.printing_id ?? defaultOf.get(r.oracle_id) ?? null;
    // The row whose chosen or default printing gives the art, if any; otherwise the card's own art shows.
    const printedRow = cover ? (shownPrinting(cover) ? cover : undefined) : cards.filter((r) => r.board === "commander").find((r) => shownPrinting(r));
    const chosenArt = printedRow ? shownPrinting(printedRow) : null;
    const defaultArt = cover ? commanders.get(cover.oracle_id)?.image_art_crop : own[0]?.image_art_crop;
    const printedArtist = (r: Row) => (r.printing_id ? r.printing_info?.artist : defaultArtistOf.get(r.oracle_id)) ?? null;
    const defaultArtist = (cover ? commanders.get(cover.oracle_id)?.artist : own[0]?.artist) ?? null;
    return {
      id: d.id as string,
      name: d.name as string,
      updated_at: d.updated_at as string,
      card_count: cards.filter((r) => r.board === "commander" || r.board === "main").reduce((n, c) => n + c.quantity, 0),
      art: chosenArt ? printingImage(chosenArt, "art_crop") : (defaultArt ?? null),
      artist: printedRow ? printedArtist(printedRow) : defaultArtist,
      commander: own.map((c) => c.name).join(" & ") || null,
      identity: [...new Set(own.flatMap((c) => c.color_identity))],
      folder_id: folderOf.get(d.id as string) ?? null,
      visibility: d.visibility as DeckTile["visibility"],
    };
  });
  const counts = folderCounts(rows.map((r) => ({ folder_id: r.folder_id ?? null })));
  const shown = inFolder(rows.map((r) => ({ ...r, folder_id: r.folder_id ?? null })), pick);
  const openFolder = folders.find((f) => f.id === pick.id);

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
            {folders.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <span className="opacity-80">Folder</span>
                <select name="folder" defaultValue={pick.id ?? ""} aria-label="Folder" className="min-h-11 max-w-48 rounded-lg border border-foreground/20 bg-background px-2">
                  <option value="">No folder</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="btn btn-gold min-h-11 px-5">New deck</button>
          </div>
          <p className="mt-3 text-sm opacity-80">
            New to Deck Genome?{" "}
            <Link href="/guide" className="underline">
              Read the step-by-step guide
            </Link>
            .
          </p>
        </div>
      </form>

      {error && <p className="mt-6 text-sm text-red-400">Couldn&apos;t load your decks: {error.message}</p>}

      {rows.length > 0 && (
        <>
          <div className="mt-8 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display text-xl">{openFolder ? openFolder.name : pick.noFolder ? "Decks in no folder" : "My decks"}</h2>
            <DropHint />
          </div>
          {foldersReady && <FolderBar folders={folders} counts={counts} total={rows.length} current={pick.id} noFolder={pick.noFolder} />}
          <DeckList
            key={pick.id ?? (pick.noFolder ? "none" : "all")}
            decks={shown}
            folders={foldersReady ? folders : undefined}
            empty={openFolder ? "No decks in this folder yet. Make one above, or use Folder on any deck to move it here." : "Every deck is in a folder."}
          />
        </>
      )}
      {together.length > 0 && (
        <section className="mt-10">
          <h2 className="display text-xl">Building with friends</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {together.map((d) => (
              <li key={d.id}>
                <Link href={`/decks/${d.id}`} className="block min-h-11 rounded-lg border border-foreground/15 px-3 py-2 hover:bg-foreground/5">
                  <span className="block font-semibold">{d.name}</span>
                  <span className="block text-xs opacity-75">{d.owner ? `${d.owner}'s deck` : "A friend's deck"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
