"use client";

// Opens the guest deck from local storage, then hands it to the ordinary editor in guest mode.
import { useEffect, useState } from "react";
import { DeckEditor } from "@/app/decks/[id]/deck-editor";
import { emptyGuestDeck, GUEST_DECK_ID, GUEST_KEY, readGuestDeck, type GuestDeck } from "@/lib/deck/guest-deck";
import { DEFAULT_ROLE_TARGETS } from "@/lib/roles";
import { withoutBracketTargets } from "@/lib/tags/role-settings";
import { readSuggestSettings } from "@/lib/suggest/score";
import { readCutterPrefs, readCutterState } from "@/lib/cutter/state";

export function TryBuilder() {
  const [deck, setDeck] = useState<GuestDeck | null>(null);
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(GUEST_KEY);
    } catch {}
    setDeck(raw ? readGuestDeck(raw) : emptyGuestDeck());
  }, []);
  if (!deck) return <p className="mx-auto max-w-3xl px-6 py-16 text-center opacity-70">Opening your deck…</p>;

  const targets = withoutBracketTargets({ ...DEFAULT_ROLE_TARGETS });
  return (
    <DeckEditor
      guest
      deck={{ id: GUEST_DECK_ID, name: deck.name, visibility: "private" }}
      initialEntries={deck.entries}
      initialCategories={deck.categories}
      initialPrintings={deck.printings}
      initialPreferred={{}}
      initialCards={deck.cards}
      readOnly={false}
      savedTagView={{}}
      hiddenTags={[]}
      userId={null}
      roleTargets={targets}
      customRoles={[]}
      suggestSettings={readSuggestSettings(null)}
      dismissedSuggestions={[]}
      playtestFlags={{}}
      cutterState={readCutterState(null)}
      cutterPrefs={readCutterPrefs(null)}
      targetBracket={3}
      profileDefaults={{ targets, custom: [] }}
    />
  );
}
