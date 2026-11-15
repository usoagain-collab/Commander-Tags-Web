// Welcome tour (V3): a short walkthrough on a signed-in builder's first deck, pointing at the parts people miss.
// Each step names a data-tour target in the editor; a step whose target isn't on screen (a phone layout, a deck
// with no cards yet) still shows its text. Seen once, remembered in profiles.tag_view.tourSeen. No migration.

export type TourStep = { target: string; title: string; text: string };

export const TOUR_STEPS: TourStep[] = [
  {
    target: "roles",
    title: "What this deck needs",
    text: "Each bar is a job a Commander deck has to do, like ramp, card draw and removal. The cards are sorted by their Scryfall tags, and the bar fills as you add cards for that job. Edit targets sets how many cards each job needs.",
  },
  {
    target: "suggest",
    title: "Suggestions",
    text: "Suggest finds cards for whatever this deck is short of, in your commander's colors. Open it whenever a bar is low.",
  },
  {
    target: "bracket",
    title: "Bracket",
    text: "This is the power bracket the deck looks like it fits, from 1 to 5. Click it to set the bracket you want and see what pushes the deck up.",
  },
  {
    target: "playtest",
    title: "Playtest",
    text: "Shuffle up, draw a hand and play a few turns alone to see how the deck starts. Flag the cards that sit in your hand.",
  },
];

/** On a builder's own deck, until it has been seen once or skipped. */
export const shouldShowTour = (prefs: Record<string, unknown>, readOnly: boolean) => !readOnly && prefs.tourSeen !== true;

/** The first element for a target that is actually on screen (the role bars render in more than one layout). */
export function findTarget(doc: Pick<Document, "querySelectorAll">, target: string): Element | null {
  for (const el of doc.querySelectorAll(`[data-tour="${target}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}
