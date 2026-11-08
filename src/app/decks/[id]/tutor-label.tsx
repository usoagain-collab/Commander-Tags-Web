// The blue Tutor label (Smart Cutter C1b, David, Nov 7, 2026) on cards that count toward the Tutors role.
// It's a label, not a button: on a card image it sits inside the card's own button, so a tap opens the card like
// the rest of the image (no small tap targets on card images). Desktop shows the explanation on hover; the card
// sheet shows it under the card's details for phones.

export const TUTOR_HELP =
  "Tutors find the card you need, so one tutor can stand in for removal, ramp or a combo piece. They make a deck more consistent and stronger, but also more predictable. Think about how they fit your theme, your power level and your bracket: fewer in low brackets, more in high ones.";

/** On a card image (grid and stacks tiles, the card sheet). */
export function TutorBadge() {
  return (
    <span title={TUTOR_HELP} className="pointer-events-auto rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow">
      Tutor
    </span>
  );
}

/** On a Text view row. */
export function TutorChip() {
  return (
    <span title={TUTOR_HELP} className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
      Tutor
    </span>
  );
}

/** In the card sheet, for phones (no hover) and anyone who wants the longer word. */
export function TutorNote() {
  return (
    <p className="mt-1 rounded-md bg-blue-500/10 px-2 py-1.5 text-sm text-blue-800 dark:text-blue-200">
      <span className="font-semibold">Tutor.</span> {TUTOR_HELP}
    </p>
  );
}
