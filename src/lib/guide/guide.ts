// "Build your first deck" guide (V3; spec.md Future note): one page at /guide that walks a new builder through every
// tool in order, from making the deck to sharing it. The role targets shown come from the code itself
// (STANDARD_ROLES and DEFAULT_ROLE_TARGETS), so the guide can't drift from what new decks start with.
import { STANDARD_ROLES } from "@/lib/tags/roles";

export type GuideStep = { id: string; title: string; points: string[] };

/** The starting targets a new deck gets, in the order the bars show. Tutors follows the target bracket. */
export function startingTargets(): { name: string; target: number | null }[] {
  return STANDARD_ROLES.map((r) => ({ name: r.name, target: r.key === "tutors" ? null : r.target }));
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: "start",
    title: "1. Start a deck",
    points: [
      "On My decks, give the deck a name, pick the bracket you're building for (you can change it later) and press New deck. Folders on My decks keep a growing list tidy.",
      "No account yet? Start building on the home page opens the full builder, and Sign in to save keeps the deck when you're ready.",
      "Want a head start? Open any precon and press Start a deck from this for your own copy, or open an empty deck and choose Or import a list you already have.",
    ],
  },
  {
    id: "commander",
    title: "2. Pick your commander",
    points: [
      "An empty deck asks Who leads this deck? Type a commander's name and pick it. Its colors, the suggestions and the tags all follow from it.",
      "Can't decide? Spin the wheel shows five random commanders to choose from.",
      "Partners and backgrounds work too: open a second card and press Make commander.",
    ],
  },
  {
    id: "roles",
    title: "3. Read What this deck needs",
    points: [
      "Each bar is a job a Commander deck has to do. Cards count toward a bar from their Scryfall tags, so you never sort them by hand.",
      "A bar shows how many cards you have against its target, then says how many are missing, ✓ on target, or how many over.",
      "Click a role's name to light up the cards that fill it. The ⓘ next to it explains what counts.",
    ],
  },
  {
    id: "targets",
    title: "4. Adjust the role targets",
    points: [
      "Press Edit targets above the bars. Each role gets a slider: drag it to the number of cards you want for that job.",
      "A combo deck might want more Tutors and fewer Board wipes; a deck with lots of mana rocks can run fewer Lands. The Tutors target follows your target bracket until you move its slider.",
      "Hide stops tracking a role in this deck (Show brings it back). + Add a role from a tag tracks something your deck cares about, like tokens or sacrifice outlets.",
      "Drag a role to reorder the bars. Save as my defaults starts every new deck with these targets; Reset to defaults and Reset the order undo your changes. Press Done when you're finished.",
    ],
  },
  {
    id: "fill",
    title: "5. Fill the deck",
    points: [
      "✦ Suggest cards finds what this deck is short of, in your commander's colors. The ✦ Suggest beside a bar looks only for that role.",
      "In Suggest, Price cap keeps cards under a price, Scryfall filter narrows the pool, and Wording matches finds cards that say what your commander says.",
      "⌕ Search looks through every Commander card by name, rules text or Scryfall syntax. Add a card by name is the quick way when you know what you want.",
      "Not sure about a card? Open it and press Move to maybeboard. It stays with the deck without counting toward the 100.",
    ],
  },
  {
    id: "cards",
    title: "6. Work with each card",
    points: [
      "Click any card to open it: see its tags and price, change its Printing & foil, move it between boards, or Add to another deck.",
      "The Note box on a card keeps a line for yourself, like \"swap for Rhystic Study once bought\". Only you see it, even on a shared deck.",
      "Top tags lists what your deck does most, with your commander's own tags first. Click one to suggest more cards like it.",
      "My tags are your own labels, like \"swap later\" or \"pet card\". Give a card one and group the deck by it.",
      "View, Group and Sort above the list change how the deck is laid out. Nothing in the deck changes.",
    ],
  },
  {
    id: "lands",
    title: "7. Sort out the mana",
    points: [
      "⛰ Auto build on the Lands bar (or More › Auto build land base) fills the lands for your colors, with basics making up the rest.",
      "More › Stats has the mana base checkup: a land count suggested from your curve and cheap ramp, lands that enter tapped, and ramp an artifact wipe would hit.",
      "Stats also gives a Deck health score out of 100 from your targets, land count, curve, colors and tapped lands. It's a rough guide, not a power rating.",
    ],
  },
  {
    id: "cut",
    title: "8. Cut down to 100",
    points: [
      "Most decks end up too big. When yours is over 100, a ✂ Cut button shows how many to go.",
      "The Smart Cutter lists what to cut and why, keeping each role near its target. Lock any card you never want suggested.",
    ],
  },
  {
    id: "bracket",
    title: "9. Check the bracket",
    points: [
      "The bracket badge shows the power bracket the deck looks like, from 1 to 5. Click it to set your Target bracket.",
      "The Bracket screen shows what pushes the deck up, How it plays, combos in the deck and combos one card away.",
      "Brackets are a rough guide. Talk to your playgroup before the game, as Wizards of the Coast suggests.",
    ],
  },
  {
    id: "playtest",
    title: "10. Playtest it",
    points: [
      "▶ Playtest shuffles the deck, deals a hand and lets you mulligan, then play a few turns alone.",
      "Notice a card that keeps sitting in your hand? Flag it as an underperformer (F on a keyboard, or the card's menu) so you remember to look at it later.",
      "Play with friends starts a room with a code to send them, so you can play together online.",
    ],
  },
  {
    id: "share",
    title: "11. Share it and keep it",
    points: [
      "↗ Share picks who can open the deck: Private, Anyone with the link, or Public. Others can look but never change it.",
      "More › History keeps versions as you edit, so you can see what changed and restore an older list.",
      "More › Compare with another deck puts it beside your other decks or a precon, and Similar decks finds public decks with the same commander.",
      "More › Export gives a list to paste anywhere, and Make a copy gives you a second deck to try ideas in without touching this one. Take the quick tour shows the short walkthrough again.",
    ],
  },
];
