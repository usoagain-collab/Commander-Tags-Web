import { notFound, redirect } from "next/navigation";
import { entryKey, type Board, type Categories, type Entries, type Printings } from "@/lib/deck/model";
import { printingImage } from "@/lib/deck/printing";
import { readManaValues } from "@/lib/deck/mana-values";
import { readSplit, type Splits } from "@/lib/deck/splits";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import { readCustomRoles, readTargets, withoutBracketTargets } from "@/lib/tags/role-settings";
import { readCutterPrefs, readCutterState } from "@/lib/cutter/state";
import { readSuggestSettings } from "@/lib/suggest/score";
import type { BracketNumber } from "@/lib/brackets/rules";
import { DeckEditor } from "./deck-editor";
import { loadDeck, UUID } from "./load-deck";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Deck · Deck Genome" };
  const { deck, builder, rows, cards, preferred } = await loadDeck(id, "editor");
  if (!deck) return { title: "Deck · Deck Genome" };
  // What a pasted link shows in Discord and elsewhere. Only someone allowed to open the deck gets this far.
  const commanderIds = new Set(rows.filter((r) => r.board === "commander").map((r) => r.oracle_id));
  const commanders = cards.filter((c) => commanderIds.has(c.oracle_id));
  const commanderPrinting = rows.filter((r) => r.board === "commander").map((r) => r.printing ?? preferred[r.oracle_id]).find(Boolean);
  const size = rows.filter((r) => r.board === "commander" || r.board === "main").reduce((n, r) => n + r.quantity, 0);
  const title = `${deck.name} · Deck Genome`;
  const description = [commanders.map((c) => c.name).join(" & ") || "Commander deck", `${size} cards`, `Bracket ${deck.target_bracket ?? 3}`, builder?.name && `by ${builder.name}`]
    .filter(Boolean)
    .join(" · ");
  const art = commanderPrinting ? printingImage(commanderPrinting.id, "art_crop") : commanders.find((c) => c.image_art_crop)?.image_art_crop;
  return {
    title,
    description,
    openGraph: { title, description, images: art ? [art] : undefined },
    twitter: { card: art ? "summary_large_image" : "summary", title, description, images: art ? [art] : undefined },
  };
}

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  // One call brings the deck, card details, the deck's tags and your view settings, so the editor opens with
  // its role profile and top tags ready.
  const loaded = await loadDeck(id, "editor");
  const { user, deck } = loaded;
  if (!deck) {
    if (!user) redirect(`/login?next=${encodeURIComponent(`/decks/${id}`)}`);
    notFound();
  }
  const { rows, cards: summaries, tags: initialTags, combos: initialCombos, profile } = loaded;

  const entries: Entries = {};
  const categories: Categories = {};
  const printings: Printings = {};
  const splits: Splits = {};
  for (const r of rows) {
    entries[entryKey(r.board as Board, r.oracle_id)] = r.quantity;
    if (r.category) categories[entryKey(r.board as Board, r.oracle_id)] = r.category;
    if (r.printing) printings[entryKey(r.board as Board, r.oracle_id)] = r.printing;
    const split = readSplit(r.split);
    if (split) splits[entryKey(r.board as Board, r.oracle_id)] = split;
  }
  const cards = Object.fromEntries(summaries.map((c) => [c.oracle_id, c]));
  const owner = deck.owner_id === user?.id;

  return (
    <DeckEditor
      deck={{ id: deck.id, name: deck.name, visibility: deck.visibility, cover_oracle_id: deck.cover_oracle_id, mana_values: readManaValues(deck.mana_values) }}
      initialEntries={entries}
      initialCategories={categories}
      initialPrintings={printings}
      initialSplits={splits}
      initialPreferred={loaded.preferred}
      initialCards={cards}
      initialTags={initialTags}
      initialCombos={initialCombos}
      readOnly={!owner}
      builder={owner ? null : loaded.builder}
      savedTagView={profile?.tag_view ?? {}}
      hiddenTags={profile?.hidden_tags ?? []}
      userId={user?.id ?? null}
      roleTargets={readTargets(deck.role_targets)}
      customRoles={readCustomRoles(deck.custom_roles)}
      suggestSettings={readSuggestSettings(owner ? deck.suggest_settings : null)}
      dismissedSuggestions={owner ? (deck.dismissed_suggestions ?? []) : []}
      playtestFlags={owner ? (deck.playtest_flags ?? {}) : {}}
      cutterState={readCutterState(owner ? deck.cutter : null)}
      cutterPrefs={readCutterPrefs(profile?.cutter_prefs)}
      targetBracket={((deck.target_bracket as number | null) ?? 3) as BracketNumber}
      profileDefaults={{
        targets: withoutBracketTargets({ ...DEFAULT_ROLE_TARGETS, ...readTargets(profile?.default_role_targets) }),
        custom: readCustomRoles(profile?.custom_roles),
      }}
    />
  );
}

