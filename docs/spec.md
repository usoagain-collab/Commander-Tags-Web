# Tag-First Commander Deck Builder: Feature Spec

Exported Oct 17, 2026, from the living spec doc. Update both when decisions change.

## Summary

A Commander-only deck builder where Scryfall Tagger tags drive everything: auto-categories, a role profile with target sliders, and card suggestions ranked by how well a card's tags fit the deck.

The core bet: suggesting cards by **function** (what a card does) beats suggesting by **popularity** (what everyone else plays), and surfaces strong cards nobody is running yet. v1 has to feel as fast and clean as Moxfield, and also ships a playtester and bracket targeting.

## Audience & scope

Built for David first, then free tests with friends, then possibly a public free site supported by ads.

- **Format:** Commander only. 100-card singleton, color identity enforced, with support for partners, backgrounds and companions.
- **Devices:** desktop-first (where deckbuilding happens), usable on a phone for viewing and light edits.
- **Money:** free to use. Ads only if it goes public, and never inside the playtester. Wizards' Fan Content Policy requires fan tools to be free to access, so check it before launch.
- **Success test for v1:** building a deck here feels faster than Moxfield, and the suggestions find cards David wouldn't have found on EDHREC.

## Tag engine

All tag data is downloaded once a day and stored locally, so tag lookups while building are instant and never hit Scryfall's rate limits.

- **Sources:** Scryfall bulk files. *Oracle Cards* holds one record per card, with legality, color identity, today's prices, EDHREC rank and image links. *Oracle Tags* holds every Tagger tag and the cards it applies to. *Art Tags* holds art tags keyed by illustration. Oracle data joins on `oracle_id`, the ID shared by every printing of a card.
- **Daily refresh:** a scheduled job downloads the files and rebuilds the card and tag tables. Card text rarely changes, so this mostly picks up new tags and today's prices.
- **In the app:** when a deck opens, the app loads the tags for every card in it in one request. Adding a card returns its tags immediately, and the role profile and top-tags panel update live.
- **Fallback:** if a card isn't in the local data yet (for example during spoiler season), run a live `otag:` search against Scryfall's API and cache the result.
- **Role map:** the app defines about 10 core roles (Ramp, Card advantage and so on), each mapped to one or more tags. Every other tag counts as a *theme tag* and feeds the top-tags panel.

## Role profile & sliders

Every deck has a profile panel showing each role's current count against a target the builder sets with a slider. Each bar turns green when the target is met, amber when under, and grey when over.

| Role | Example tags it maps to | Default target |
| --- | --- | --- |
| Lands | land type lines (not a tag) | 37 |
| Ramp | `ramp`, mana rocks, mana dorks | 10 |
| Card advantage | `card-advantage`, draw, impulse draw | 10 |
| Targeted removal | `removal` and its creature, artifact and enchantment subtags | 8 |
| Board wipes | sweeper or wrath tags | 3 |
| Protection | protection or hexproof-granting tags | 3 |
| Recursion | graveyard-return tags | 2 |

- Defaults follow common Commander templates and don't change with the target bracket. Each user can save their own default targets in their profile, and every new deck starts from them.
- A card can count toward several roles. A creature that ramps and draws fills both bars.
- **Custom roles:** the builder can turn any tag into a role with its own slider, for example "Sac outlets: 6".
- **Top tags panel:** a live, ranked list of the theme tags that appear most often in the deck. The commander's own tags are pinned at the top as the starting theme.
  - A **Gameplay | Flavor** switch flips the panel between what cards do (oracle tags) and how they look (art tags, plus name and wording tags). A builder can lean into a flavor theme like frogs, then flip back to check the deck still functions.
  - A **Specific | Broad** switch: Specific keeps every tag as applied, deepest first. Broad rolls tags up to their parents.
  - A **Sort** switch picks Relevance or Count.
  - Clicking a tag highlights those cards in the deck and opens suggestions for it. Hovering a tag shows its place in the tag tree.
- Sliders and custom roles save with the deck. Hidden tags save to the user's profile.

## Suggestion engine & ranking styles

Suggestions come from the deck's own tags, and the builder chooses how they're ranked with a "Suggestion style" switch.

**How it works**

1. **Trigger:** click an under-target role bar, click a theme tag, or press "Suggest" for overall picks.
2. **Candidate pool:** cards that are Commander-legal, inside the commander's color identity, not already in the deck, and carry the selected tag.
3. **Score:** each candidate is scored on:
   - *Tag overlap:* how many of the deck's top theme tags it shares, weighted by how central each tag is to the deck.
   - *Gap fill:* whether it fills a role that's under target.
   - *Popularity:* its EDHREC rank from Scryfall's card data, converted to a 0–1 percentile.
   - *Price:* today's price.
4. **Bracket filter:** cards that would push the deck above its target bracket are hidden, or shown with a warning if the builder chooses.
5. **Explain:** each suggestion shows *why*, listing the tags it shares with the deck. That's how the builder learns to trust the picks.

**Ranking styles**

| Style | Tag overlap | Popularity | Price | Best for |
| --- | --- | --- | --- | --- |
| Best fit (default) | High | Medium, more popular ranks higher | Ignored | Strong, proven picks that fit the theme |
| Hidden gems | High | Inverted, less-played ranks higher | Ignored | Finding cards nobody runs |
| Budget | High | Low | Cards over a price cap are hidden, cheaper ranks higher | Cheap builds, with a price-cap slider |
| Custom | Slider | Slider | Slider | Builders who want full control |

Each suggestion can be added to the mainboard or maybeboard in one click, or dismissed so it doesn't come back for that deck.

## Bracket targeting & alerts

The builder picks a target bracket (1–5) when creating the deck. The app keeps suggestions inside that bracket and warns as soon as the deck drifts above it.

- **Checks run on every change:**
  - Game Changers count, from WotC's current list.
  - Two-card infinite combos, from Commander Spellbook's combo database.
  - Mass land denial.
  - Extra-turn cards.
- **Rules as config:** the limits for each bracket are stored as data, not hard-coded, so a WotC update means editing one file rather than shipping new code.
- **Alerts:** the header badge turns amber and opens the Bracket screen, which names what crossed the line ("Adds a 2-card combo: Card A + Card B"); the card gets a badge. No separate banner (David, Nov 1, 2026). Nothing is blocked; the builder decides.
- **Estimated bracket:** a badge on the deck always shows the bracket the list currently plays at, next to the target.
- **Suggestions:** cards that would break the target are filtered out by default, with a toggle to show them.

## Deck editor features

The editor matches what people like about Moxfield and fixes its known complaints. Every item below is in v1.

| Feature | What it does | Why it's in |
| --- | --- | --- |
| Card search | Full Scryfall syntax with `otag:` autocomplete; legality and color identity applied automatically. Cards already in the deck show their count, and a **Hide cards in deck** toggle removes them from results | The main way to find cards, with tags built in; hiding is Moxfield's #3 request (307 votes) |
| Quick add | Type-ahead card names; Enter adds the card | Reviews complain about typing full names |
| Drag from Scryfall | Drop a card image from a Scryfall tab onto the open deck, or onto any deck in your deck list | Moxfield only accepts drops on an open deck; users have asked for more |
| Import / export | Paste or export text in Moxfield, Archidekt, MTGO and Arena formats | People keep their other tools; zero lock-in |
| Auto-categories | Cards grouped by role from their tags; drag to override | Archidekt's best-liked feature, done with tags |
| Views | Visual (card images), stacks, and text | Standard across both sites |
| Group / sort | By role, type, mana value, color or custom category | Standard |
| Maybeboard | Holding area for cards under consideration; suggestions can go straight here | Standard |
| Stats | Mana curve, color pips against land sources, type breakdown | Standard |
| Pricing | Today's price per card and the deck total (USD), from Scryfall's daily data. A card with a chosen printing uses that printing's price, its foil price when foil; other cards use their cheapest printing | Asked for; no history needed |
| Printing picker | Pick any paper printing of a card in the deck from its card sheet; the deck shows that image and its art tags follow. Built Oct 31, 2026 (moved back from v2) | Standard |
| Foil | Mark a card in a deck as foil; a sheen on its image and a label on text rows. Built Oct 31, 2026 (moved back from v2) | Friend test |
| Card sheet | Tap or click any card (name in text view, image in visual views) to open it straight away: big image, large action buttons, its roles and tags. A bottom sheet on phones, a window with Prev / Next on desktop. No tiny icons on top of card images | Moxfield's ⋯ on the image is hard to hit on mobile |
| Card details | Rules text, P/T or loyalty, both faces, legality in every format, and rulings, fetched live from Scryfall. The card's tags take the place of buy links | Asked for; tags are this app's point |
| My tags | Your own labels on cards ("Combo", "Win con"…), several per card, added from the card sheet. Each is **this deck only** or **account-wide**: an account-wide tag and where it's applied follow the card into every deck (tag Sol Ring "Staple" once, it's a Staple everywhere). A "Show my tags" switch, Group by My tags, click to highlight, rename / recolor / change scope / delete | Moxfield-style tags, asked for by David (Oct 19, 2026) |
| Tokens list | Tokens the deck can create | Standard, helps playtesting |
| Share link | Read-only link; decks are private, unlisted or public | Needed for friend tests |
| Autosave | Every change saves instantly; undo with Ctrl+Z | Feels good to use |
| Version history | Every deck keeps saved versions. See what changed between two versions (added / removed cards), and restore an old one. Restoring is itself a change, so it can be undone | Moxfield's #2 request (592 votes); Archidekt has it. Added Oct 18, 2026 |
| Bulk edit | Select several cards (checkboxes or Shift-click), then move them to another board, add or remove a My tag, change quantity or remove them, all at once and as one Ctrl+Z | Moxfield's #5 request (255 votes). Added Oct 18, 2026 |
| Role subgroups | With Group by Role, each role splits into its subtags (Ramp › mana rocks, mana dorks, land ramp), using the tag tree; each subgroup collapses | Archidekt subcategories request (240 points). Added Oct 18, 2026; step 3e |
| Big-list performance | A 100-card deck plus a 300-card maybeboard stays smooth (measured Oct 19, 2026: every switch under ~120 ms on a 400-card deck, so no virtualization yet; if a re-check lags, long lists draw only what's on screen) | Both sites slow down past about 150–200 cards |

## Playtester

A solo goldfish playtester, built to be fast to use and kept free of ads.

- **Zones:** library, hand, battlefield, graveyard, exile and command zone, with drag between zones.
- **Start of game:** shuffle, draw 7, London mulligan, commander in the command zone with a tax counter.
- **Turn actions:** draw, tap and untap (one key untaps all), turn counter, life total, +1/+1 and other counters, tokens from the deck's token list.
- **Library tools:** search, scry, mill, reveal top card.
- **Keyboard shortcuts:** for every common action, so a test game moves quickly.
- **Flag while testing:** one key flags the card under the cursor as an underperformer. Flags show up as a badge back in the editor.
- **Opening-hand stats:** run 1,000 simulated opening hands and show land count spread and the odds of having ramp by turn 2. These use the same role tags as the profile.
- **Ad-free:** no ads ever appear inside the playtester. Moxfield users reported ads covering cards in hand.

## Accounts & saving

Decks save to a hosted database tied to a user account, with sign-in through Discord or Google, from day one.

- **Why accounts:** friend tests need share links and decks that follow you between devices. Browser-only storage can't do either.
- **Service:** Supabase, which provides a Postgres database plus sign-in. Its free tier covers David and a test group.
- **What's saved per deck:**
  - Cards, with board (main, maybe, commander) and chosen printing.
  - Role targets and custom roles.
  - Target bracket and suggestion style.
  - Dismissed suggestions and playtest flags.
- **Saved per user:** default role targets, hidden tags, last-used tag view settings.
- **Privacy:** row-level security, so a user can only read or change their own decks. Shared decks are read-only to others.
- **Backup:** text export is always available, so nobody's decks are trapped here.

## Out of scope for v1

- Formats other than Commander
- Price history and price charts (today's price only)
- Collection tracking and "cards I own" filters
- Primers, comments, likes and other social features
- Multiplayer playtesting
- A native mobile app
- Paid features

## v2 backlog

Ideas for after v1 is fully working and tested with friends (phase 7). When something new comes up that's out of v1 scope, David decides whether it goes here or under "Not intended".

| Feature | What it means | Added |
| --- | --- | --- |
| Mixed copies of one card | Different printings or foil for copies of the same card on one board, such as 10 Forests with different art. Today one row holds one printing | Oct 31, 2026 |
| Pricing details | Prices per store and price settings (foil and per-printing prices are built) | Oct 18, 2026 |
| Collection tracking | Ownership checkmarks, "add to collection", the "unowned" price total (also listed under Out of scope for v1) | Oct 18, 2026 |
| Wish list | Cards you want to buy, separate from any deck | Oct 18, 2026 |
| Change mana cost | Override a card's displayed mana cost for stats (e.g. X spells) | Oct 18, 2026 |
| Multiplayer playtesting | Playtest against other players (v1's playtester is solo goldfish, phase 6) | Oct 18, 2026 |
| Gamer look and feel | Friend test: the site feels too professional. Give it an aesthetic for Magic players (theme, colors, card-game feel); exact direction decided in v2 | Oct 24, 2026 |
| Link sign-in methods | A "Link Google / Discord to this account" button, so one account works with both. Supabase merges sign-ins automatically only when both report the same verified email; otherwise each method makes its own account. Needs manual identity linking turned on in Supabase | Oct 24, 2026 |
| Refined bracket estimate | A smarter bracket estimator that weighs combos, Game Changers and, most importantly, theme cohesiveness (how tightly the deck's cards share themes), instead of v1's floor from rule-breaking cards alone. Exact specs to be decided in the v2 build | Oct 24, 2026 |
| Copy to my decks | Design judges: a button on a shared deck that copies it into the viewer's own decks, so a friend can start from it. **Built Nov 8, 2026**: gold **Copy to my decks** on shared decks (signed-out viewers sign in first), **More → Make a copy** on your own; a private copy with cards, printings, categories, role targets, bracket and deck image (not My tags, flags or suggestion settings) | Oct 31, 2026 |
| Built by <name> | Design judges: show the builder's name on a shared deck. **Built Nov 8, 2026**: "Built by <picture> <name>" in a shared deck's header and in its link preview; Settings → Your name sets it (40 characters) | Oct 31, 2026 |
| Spin the wheel for a commander | A "Spin the wheel" button when picking a commander for a new deck: it serves 5 random Commander-legal commanders to choose from, with a re-spin. The 5 show as a preview on a full-screen frosted overlay, like the Bracket screen on the deck page. Each one shows the full card image, its tags, and the archetypes it is commonly built for. **Built Nov 8, 2026**: 🎲 **Spin the wheel** under "Who leads this deck?"; 5 random legal commanders (a random EDHREC rank, then the first commander at or after it; flip cards with a legendary back face re-roll), each with **Lead with …**, up to 6 gameplay tags and "Built for" = the starter archetypes its own tags point to (no EDHREC data, so it reads the card, not what players build); Spin again never repeats a commander in the same visit | Nov 7, 2026 |
| Smart Cutter | Helps cut a deck down using its roles, top themes and targets, and explains every suggestion. Default and power user modes. **Built Nov 7, 2026**; design in "Smart Cutter (v2 design)" below | Nov 7, 2026 |
| EDHREC suggestions | An EDHREC option for players who still want the cards other players commonly run with their commander, like Moxfield's EDHREC panel (top cards, high synergy, lands and so on). Cards can be excluded as they show up (e.g. a land you know you won't play), and excluded cards stay off the list for that deck. Data source: EDHREC's per-commander JSON, fetched server-side and cached; **needs EDHREC's permission first** (their Terms of Use bar automated queries and republishing) | Nov 7, 2026 |
| Reorder the left-column tags | Drag the roles and top tags in the left column into your own order, saved. The role profile's "Adjust targets" button becomes **"Edit targets"**, and dragging works only in that edit mode (so a stray drag never moves anything; on phones the whole row is the drag handle). **Built Nov 8, 2026**: order saved to your account (all decks), Reset the order in edit mode | Nov 7, 2026 |
| Auto build land base | An "Auto build land base" button that fills the deck's lands up to the Lands target with the best lands in the commander's colors (duals, fetches, shocks and so on, then basics in proportion to the deck's color pips). With no lands it builds the whole base; with some lands it adds only what's missing to reach the target. Utility lands are left for the user to add. Hovering the button (tap the ⓘ on phones) explains what it does and how it picks lands. One undoable `Change`. **Built Nov 8, 2026**: **⛰ Auto build** on the Lands row (while under target) and More → Auto build land base open a preview with the same explanation (so phones get it too), a price cap (any / $20 / $5 / $1) and **Add N lands**. Fixing share of the target: 2 colors 35%, 3 colors 50%, 4-5 colors 60%, mono and colorless basics only; most-played first; lands with creature-only colored mana (Cavern of Souls) count as utility | Nov 7, 2026 |
| Default roles in the profile | Edit your default roles (standard and custom, their tags, hidden ones) and target numbers on the Settings page, without opening a deck. Today defaults can only be saved from a deck's role profile ("Save as my defaults"). **Built Nov 8, 2026**: Settings → Default roles (sliders, Hide / Show, custom roles from a tag, Save defaults, Use the app's defaults; Tutors follows each deck's bracket) | Nov 7, 2026 |
| Lands in overall Suggest | Overall Suggest never shows lands today (the Staples row covers only non-land roles, and the main list leaves lands out). When the deck is under its Lands target, include lands in the suggestions, ranked like other picks, so a short land count gets filled from the same screen. Once the target is met, lands stay out as now. **Built Nov 8, 2026**: a **Lands: you're N short** row (up to 8, scored like a role's picks: themes, cheapness, popularity; bracket filter, dismissals and Budget's price cap apply) above Staples; a hidden Lands role asks for none | Nov 8, 2026 |

## v2 proposals waiting on David (Nov 8, 2026)

Everything else on the v2 backlog is built. These need a schema OK or a direction first. Each has a recommendation (★).

### Schema changes (clear items)

**Change mana cost.** Override a card's mana value for stats, per deck (X spells, cost reducers, cards you always cast for less).
- ★ **A. A column on the deck row:** `deck_cards.mana_value_override smallint null` (0-20; null = the card's own). Set from the card sheet ("Mana value for stats: Auto / number"), undoable like a category, kept by moves, versions and copies. Used by the curve, average mana value, Group and Sort by mana value, opening-hand stats and the Smart Cutter's curve. A small "≈N" mark shows on the card.
- B. Per user across all decks (a table like `preferred_printings`). Less work per deck, but an X spell's real cost differs by deck.

**Wish list.** Cards you want to buy, separate from any deck.
- ★ **A. One private list per user:** table `wishlist (owner_id, oracle_id, printing_id null, foil, quantity 1-99, note ≤200, added_at)`, owner-only. A **Wish list** page in the site header (grid and text views, total price, sort by price or date, export as a plain list or Moxfield), **Add to wish list** in the card sheet, Search and Suggest, and "on your wish list" marks in decks.
- B. Several named lists (adds a `wishlists` table). More flexible, more clicks; easy to add later on top of A.

### Decisions

**Gamer look and feel.**
- A. Tabletop: felt and wood textures, card-frame borders on panels.
- B. Arcane: deep purple, glowing runes, parchment panels.
- ★ **C. Your colors:** keep the dark base (readable, card art stands out) but take the accent from the commander's colors (hero glow, buttons, bars), frame-like borders on panels, a display font closer to card titles, playful copy and small celebrations (dice roll on Spin, mana-symbol confetti on Complete). Least risk to readability, most personal.

**Refined bracket estimate.**
- ★ **A. A transparent points model:** keep v1's floor (rules can't be undercut), then a 0-100 "power" score from fast mana, tutors, cheap interaction, combos, Game Changers, average mana value and **theme cohesion** (share of nonland cards sharing one of the top 5 themes). The score maps to "plays like N" between the floor and 4, with every point explained. Tuned on Omo and the QA decks.
- B. Calibrate against decks with known brackets (needs a labeled set we don't have).

**Collection tracking.**
- ★ **A. Per card:** table `collection (owner_id, oracle_id, quantity, foil_quantity)`. Checkmarks on deck cards you own, an "unowned" price total in the summary bar and Stats, "Hide cards I don't own" in Search, and CSV import from Moxfield / Archidekt / ManaBox collection exports.
- B. Per printing (exact set and number). Accurate for collectors but heavier, and every printing would need storing (about 110k rows; the free database can't hold them all).

**Mixed copies of one card.**
- ★ **A. A split on the existing row:** `deck_cards.printing_split jsonb` = list of {printing, foil, quantity} adding up to the row's quantity. Display, price and export use it; editing, undo and autosave stay as they are, since a row is still one card on one board.
- B. One row per printing (change the table's key). The truest model, but it touches every editing path (entries, undo, autosave, versions, change log).

**Multiplayer playtesting.**
- ★ **A. Shared table, each player runs their own deck:** a room code for up to 4 players over Supabase Realtime (nothing stored), each player's board, life, commander damage and hand size visible to the others, plus a shared turn order. No cross-player actions (stealing, targeting) in the first version.
- B. Full interaction (move cards between players, targeting, a stack). Much bigger; worth it only after A gets used.

### Blocked on David personally

- **EDHREC suggestions:** EDHREC's permission (their terms bar automated queries and republishing).
- **Link sign-in methods:** turn on manual identity linking in Supabase (Authentication → Providers settings).
- **Pricing details (per store):** an API key from a price source (TCGplayer's API is closed to new developers; JustTCG or Scryfall's own USD/EUR/TIX are options).

## Not intended

Considered and deliberately left out of this project.

- Moxfield's custom formats (Archon, Highlander variants and so on): Moxfield's own rules, with no Scryfall data behind them.

## Smart Cutter (v2 design)

Drafted Nov 7, 2026 from David's brief, adapted to the codebase. **Status: built Nov 7, 2026 (C1-C5); C6 tuning done on Omo and the 9 QA decks. Migration 0034 (cut reasons in History) applied Nov 7, 2026. Tested end to end on 10 decks (Omo plus copies of the 9 QA decks: over, exactly and under 100, brackets 1-4) with no failures.**

Helps a builder cut cards systematically, using the deck's roles, top themes and role targets, and explains every suggestion. Cuts are judged by **function** (what the deck needs) the same way suggestions are, never by popularity alone.

### Decisions so far (David, Nov 7, 2026)

- **"Selected tags" = the deck's roles + its top themes.** The roles are the standard roles (minus hidden ones, minus Lands) and custom roles, each a tag set with all its subtags (`resolveRoles` in `src/lib/tags/roles.ts`). The themes are the top 15 gameplay themes (`themeTags` in `src/lib/tags/themes.ts`, same as overall Suggest). Targets exist only on roles (`decks.role_targets`, `decks.custom_roles`), so "over target" always means a role over its slider. To give a theme a target, make it a custom role (the + in Top tags).
- **The Cutter is its own screen**, a full-screen frosted overlay like the Bracket screen (`glass-overlay.tsx`). Its **cutting-room floor** exists only on that screen: nothing is stored on a new board. **Apply** saves every cut and swap as **one** `Change` (one Ctrl+Z, one Timeline entry in History); closing with unapplied cuts asks "Apply N cuts / Discard".
- **Lands are never suggested** (land cuts come later). Spell // land MDFCs are scored like spells, and the "why" says cutting one also lowers Lands.
- **Protection = "would drop a role below target"**, not just "the only card left": a card is never suggested if cutting it puts any role under its target, and a manual cut that does so asks first.
- **The floor survives a refresh** in this tab (session storage), until Apply or Discard.
- **Apply removes the cut cards** by default, with a "Send cuts to the maybeboard" checkbox.
- **After the C1 check (Nov 7, 2026):** tutors get a **Tutors role whose default target follows the target bracket** (below); good-stuff decks that detect as Control / stax are left to the Yes / No question; nine vague tags joined the theme noise list (interrupt, intervening if clause, namesake spell, single target instant/sorcery, mini refund, refund, full refund, evasion, commander identity matters), which also cleans up Top tags and Suggest.

### Where it fits in the app

| Piece | Today | Cutter use |
| --- | --- | --- |
| Boards | `deck_cards.board`: commander, main, maybe, companion | Candidates = **mainboard** only. Commander and companion are never cut; maybe is ignored |
| Deck size | `deckSize` in `model.ts` (commander + main) | Decides the shortlist size (over / exactly / under 100) |
| Roles + targets | `buildRoleDefs`, `roleCounts`, `roleStatus` (`role-settings.ts`), manual overrides `deck_cards.category` | Role coverage, saturation, weakest-in-role. A card with a manual category counts only toward that role, as in the role profile |
| Themes | `themeTags`, `cardKeys` (`themes.ts`) | Role coverage and theme fit; commander tags count double, as today |
| Bracket | `estimateBracket`, `overTarget` (`src/lib/brackets/evaluate.ts`), `decks.target_bracket` | Bracket conflict flag |
| Combos | `combos` table, `combos_within(ids)`, already loaded by `useCombosWithin` | Combo protection |
| Colors | `pipsOf`, `colorBalance` (`src/lib/deck/stats.ts`) | Mana strain flag |
| Curve | `manaCurve` (`stats.ts`) | Effective curve and curve fit |
| Popularity | `card_summaries.edhrec_rank`, `popularity()` in `src/lib/suggest/score.ts` | Tiebreaker only |
| Swaps | `suggestion_pool` (migration 0012) + `scorePool` | Swap suggestions; cut cards from this visit are checked first |
| Saving | `apply_deck_changes` (one transaction per edit), `deck_change_log` trigger groups an edit by transaction id | Apply = one call = one Timeline entry |

### 1. Archetype detection (drives the expected curve)

- **Config file** `src/lib/cutter/archetypes.ts`: each archetype has a key, name, **detection signals** (tag slugs, each including its subtags; type-line counts; deck facts), an **expected curve** and optional **cheat rules**. A unit test fails if any slug isn't in the tag tree (like `resolveRoles` reporting `missing`).
- **Detection score** per archetype = Σ signal weight × share of nonland cards with that signal, commander's own tags × 3 (the commander is the strongest hint). The best one at or above a confidence floor is shown; otherwise **General (midrange)** with a default curve.
- **Default mode:** a label at the top of the Cutter, "Detected: Graveyard. Is this your archetype? Yes / No". **No** offers the next most likely one, in order. After the 3rd No: "Pick one from the list, or keep seeing suggestions?" Yes or a pick is saved per deck and isn't asked again (a small "Change" link stays).
- **Power user:** create and edit custom archetype profiles (name, signals, curve, cheat rules), saved per user so they work in every deck.

**Starter set** (slugs checked against our tag data Nov 7, 2026; numbers are cards in each tag's subtree). The curve is the share of nonland spells at mana value 0-1 / 2 / 3 / 4 / 5 / 6 / 7+, in percent. **The curves are starting guesses to tune with real decks.**

| Archetype | Main signals | Expected curve |
| --- | --- | --- |
| General (fallback) | none | 12 / 22 / 24 / 18 / 12 / 7 / 5 |
| Graveyard / reanimator | `reanimate` (1,130), `mill-self` (1,129), `discard-outlet` (1,402), `graveyard-fuel` (482), `loot` (443), `recursion-creature` (929) | 20 / 28 / 24 / 14 / 8 / 4 / 2 (effective) |
| Aristocrats | `sacrifice-outlet` (1,554), `death-trigger` (1,682), `drain-life` (439), `blood-artist-ability` (40) | 16 / 28 / 26 / 16 / 8 / 4 / 2 |
| Spellslinger | `cast-trigger-you` (1,364), `copy-spell` (212), `prowess-like` (84), `magecraft` (32), `storm-count-matters` (28), `cost-reducer-instant-sorcery`; instants + sorceries ≥ 35% of spells | 20 / 30 / 24 / 14 / 7 / 3 / 2 |
| Voltron | **type lines** Equipment / Aura; `synergy-equipment` (255), `synergy-aura` (200), `quick-equip` (253), `commander-matters` (54) | 18 / 30 / 24 / 14 / 8 / 4 / 2 |
| Tokens | `repeatable-creature-tokens` (1,558), `anthem` (580), `synergy-token` (240), `token-doubler` (19) | 12 / 24 / 26 / 20 / 10 / 5 / 3 |
| +1/+1 counters | `counters-matter` (1,357), `counter-doubler` (66), `counter-increaser` (88) | 12 / 26 / 26 / 18 / 10 / 5 / 3 |
| Landfall | `landfall` (308), `lands-matter` (649), `extra-land` (178), `land-count-matters` (285) | 14 / 24 / 24 / 18 / 10 / 6 / 4 |
| Artifacts | **type line** Artifact share; `artifact-count-matters` (191), `affinity-for-artifacts`, `metalcraft`, `improvise`, `artifactfall` (99), `repeatable-artifact-tokens` (209) | 22 / 26 / 22 / 14 / 8 / 5 / 3 |
| Enchantress | **type line** Enchantment share; `enchantmentfall` (73), `enchantment-engine` (22), `synergy-aura` | 14 / 28 / 26 / 16 / 9 / 4 / 3 |
| Typal | `typal-creature` (2,954) and one creature type on 30%+ of creatures (`creatureTypeCounts`) | 12 / 24 / 26 / 20 / 10 / 5 / 3 |
| Control / stax | `counterspell` (566), `tax` (490), `hate-*` subtags, `symmetrical` (939), many Board wipes | 16 / 26 / 24 / 16 / 10 / 5 / 3 |
| Big mana / ramp | Ramp role 14+ cards, `mana-increaser` (64), `mana-sink` (1,919), `x-cost-matters`; spells at 6+ ≥ 15% | 10 / 18 / 18 / 16 / 14 / 12 / 12 |
| Group hug | `group-hug` (447), `selective-group-hug` (227), `donate` (40), `symmetrical` | 10 / 22 / 24 / 20 / 12 / 7 / 5 |
| Combo | 2+ combos from `combos_within`, `tutor` (1,235), `untapper` (805), `ritual` (71) | 24 / 30 / 22 / 12 / 6 / 4 / 2 |

**Effective curve.** Cards the deck means to cheat into play don't count on the curve, so a reanimator deck is never told to cut cheap enablers because Griselbrand sits at 8.
- A **cheat target** is a nonland permanent at mana value 6+ (creature only for reanimation) in a deck with **4+ cheat enablers**: `reanimate` subtree (not `reanimate-self`), `sneak` / `sneak-from-library` / `sneak-creature`, `free-cast-another`. Enablers themselves never count as targets. Thresholds live in the config; an archetype can override them.
- The deck's effective curve = `manaCurve` over nonland spells minus cheat targets. Cheat targets get a neutral curve score, and their "why" says "Not counted on the curve: likely cheated in (5 enablers)".
- **Power user:** per card "Count on curve / Cheated in" override, saved per deck.

### 2. Keep score (per card, 0-1, higher = keep)

Weights and every threshold sit in **one config file**, `src/lib/cutter/config.ts`. Power users can change the weights (saved per user; they always add up to 100%).

| Component | Default weight | How it's computed |
| --- | --- | --- |
| Role coverage | 25% | Distinct selected items the card hits: each role counts once however many of its tags match (subtags included), each top theme once, and a theme that is an ancestor of another hit theme counts once with it. Score = hits ÷ the most hits any card in the deck has. Hidden roles, Lands and noise tags (`MECHANIC_NOISE`) don't count |
| Saturation pressure | 20% | For each role the card fills (Lands excluded): overness = min(1, (count − target) ÷ 3) when over target, else 0. Pressure = average overness; halved unless **all** its roles are over. Score = 1 − pressure. No tolerance band: 8 of 7 is over. A card in no role scores neutral 0.5 |
| Weakest in role | 20% | Within each role the card fills, rank it against the other cards in that role on quality = 50% mana value (cheaper is better), 25% speed (instant or flash = 1, otherwise 0.5; permanents that stay as engines aren't penalized), 25% flexibility. Flexibility is read from subtags: e.g. removal that hits more permanent types (`removal-nonland`, `multi-removal`, `removal-creature` + `removal-artifact` …) or repeats (`repeatable-removal`), one-sided wipes (`sweeper-one-sided`), repeatable vs one-time draw. Score = average percentile across its roles. A role with fewer than 3 cards gives neutral 0.5. A card in no role is compared within its strongest theme on mana value only |
| Theme fit | 15% | Shared theme weight ÷ total theme weight (the same formula as `scorePool`), normalized to the best card, commander tags double. **Leave-one-out:** the card's own tags are taken out of the theme counts first, so a card can't hold up a theme it alone creates |
| Curve fit | 8% | For the card's mana value bucket: excess = actual share − expected share (effective curve, detected archetype). Score = 1 − min(1, excess ÷ 10 points). Buckets at or under their expected share score 1; cheat targets score 1 |
| Popularity | 12% | EDHREC rank on a log scale (rank 1 = 1, rank 100 about 0.54, 20,000 or unranked = 0). Added Nov 8, 2026 (David: staples are staples for a reason) |

**Flags** (not weighted, always shown on the card and in the "why"):
- **Bracket conflict:** the card is in an over-target finding from `estimateBracket` (Game Changer over the limit, mass land denial, extra turns, combo).
- **Mana strain:** 2+ pips of a color whose share of land sources is under 20% (from `colorBalance`).
- **Popularity:** besides its 12% weight, EDHREC rank still breaks ties (keep scores within 0.01).
- **No tags yet:** a card with no oracle tags (new cards until the nightly import, about 200 legal cards overall). It isn't suggested, because its score would be meaningless.

**Cuts are picked one at a time.** After each suggested cut the counts are re-run as if it were gone, then the next weakest is picked. Otherwise four over-target Ramp cards would all be suggested when cutting one fixes Ramp.

### 3. Suggestions

**Default mode**, sized to the situation:
- **Over 100:** exactly (size − 100) cuts, weakest first.
- **Exactly 100:** the 3 weakest cards, each with **one swap**: the best card from `suggestion_pool` for that card's roles and themes, scored with Best fit, inside the bracket target (`candidateIssues`), not dismissed from Suggest, and with a higher keep score than the card it replaces. Cards on this visit's cutting-room floor are checked first.
- **Under 100:** no cuts. "You need N more cards" and the under-target roles, each with 💡 opening the existing Suggest panel for that role.

**Power user** also gets:
- **Walkthrough:** goes through over-target roles one by one, cards side by side, weakest highlighted, "Cut" or "Keep all".
- **Head to head:** two cards from the same role; pick the one that stays. Results are saved per deck and blended 50/50 into "weakest in role" for the cards compared (win rate), so the ranking learns your taste.
- **2-for-1 swaps:** two cards that each fill a single, different role (A and B) → one pool card that fills both A and B (`rolesOf` includes both).
- **What-if preview:** role bars and the effective curve, now vs after the cuts on the floor, before Apply.

### 4. "Why" pop-up

Tapping anywhere on a suggested card opens its "why" (the whole card is the tap target; on phones a bottom sheet). In plain language:
- The selected roles and themes it hits ("Ramp, Card advantage; theme: Landfall").
- Each role's count vs target ("Ramp 12 / 10: 2 over").
- How it ranks in its role ("3rd weakest of 12 Ramp cards: costs 4, most Ramp here costs 2").
- Curve impact ("4-drops are 22% of your spells; Landfall expects 18%").
- Flags, and the score breakdown as sentences with small bars ("Role coverage: hits 2 of your items (most cards hit 3)").

### 5. Guardrails

- **Lock (pet card):** one tap in the Cutter or in the card sheet ("Never suggest cutting"). Locked cards are never suggested; a 🔒 label shows on Text rows and grid tiles, like the ⚑ flag. Both modes.
- **Combo protection:** a card in any combo from `combos_within` (both pieces in the deck, any Spellbook rating) is never suggested. Power user can turn it off. Only two-card combos are known (that's all we import).
- **Below-target protection (David, Nov 7, 2026):** a card is never suggested if cutting it would put any of its roles below target (Board wipes 3 / 3: each wipe is protected; a card in an over-target role **and** an at-target role is protected too). Lands are left out of this check, so MDFCs aren't locked by the Lands count. If you remove such a card yourself anywhere in the editor (card sheet, quick remove ✕, bulk Remove, moving it to maybe), a confirmation names the role: "Board wipes would drop to 2 / 3. Remove anyway?" with "Don't warn me again" (also a setting). Bulk Remove asks once and lists every role it drops. Both modes.
- **Dismiss:** "Not a cut" removes it from the shortlist for this deck. Power user picks a reason (combo piece, pet card, meta call, other). "Show dismissed (N)" brings them back. Separate from Suggest's `dismissed_suggestions`.
- **Cutting-room floor:** a pile on the Cutter screen. Each card keeps its cut reason (the suggestion's one-line why, or "Cut by hand"), Restore puts it back, and it's the first place swaps look. It disappears on Apply or Discard; until then it's kept in session storage (`cutter:<deckId>`, this tab only, like the playtester), so a refresh doesn't lose it. If the deck changed in the meantime, cards no longer on the mainboard drop off the floor. **Apply** removes the cut cards, or moves them to the maybeboard when "Send cuts to the maybeboard" is ticked (remembered per user). Applied cuts show in History's Timeline as **one** entry labeled "Smart Cutter", each card with its reason.

### Tutors: a role with a bracket-based target (David, Nov 7, 2026)

The C1 check suggested cutting Mystical Tutor and Enlightened Tutor: they fill no role and share no themes, so they score low. Tutors matter differently by power level, so they become a role whose **default target depends on the deck's target bracket**.

- **Tutors role**, a new standard role: the `tutor` tag (1,235 cards) and its sub-tags, **minus land tutors and destination tags** (`tutor-land` and `tutor-to` subtrees). Scryfall tags what a tutor fetches (`tutor-card`, `tutor-creature`, `tutor-land-basic`) and separately where it goes (`tutor-to-hand`, `tutor-to-battlefield`); land fetchers like Kodama's Reach and Kura carry only a land kind plus a destination, so they count as Ramp. `RoleDef` gains `except` (slugs whose subtrees don't count). **Hidden by default** since Nov 8, 2026 (David): turn it on under Hidden roles → Show.
- **Default target by bracket** (in `src/lib/brackets/rules.ts` next to the other bracket data, so it's one edit to change): 1 Exhibition **0**, 2 Core **1**, 3 Upgraded **3**, 4 Optimized **6**, 5 cEDH **10**. These are Deck Genome's suggestions, not WotC rules: the Oct 2025 bracket update removed tutor limits. Starting guesses to tune.
- **Follows the bracket until you move it:** with no `tutors` key in `decks.role_targets`, the target comes from the bracket and changes when the bracket does. Moving the slider saves the number, and it stays put after that; Reset brings back the bracket default. "Save as my defaults" doesn't store a tutors number, so every deck keeps following its own bracket.
- **In the Cutter:** an ordinary role. Over target, tutors feel saturation pressure (a bracket 2 deck with 5 tutors gets told to cut some); at or under target, they are protected by the below-target rule. The "why" says "Tutors 5 / 1 for bracket 2".
- **Blue Tutor label on the card image** (editor grid tiles, stacks and the card sheet image; a chip on Text rows), for cards that count as Tutors. On desktop, hovering it shows: "Tutors find the card you need, so one tutor can stand in for removal, ramp or a combo piece. They make a deck more consistent and stronger, but also more predictable. Think about how they fit your theme, your power level and your bracket: fewer in low brackets, more in high ones." **Phones:** a hover doesn't exist, and a separate tap target on the image is what David ruled out (Moxfield's ⋯), so the label is not its own button: tapping it opens the card like the rest of the image, and the card sheet shows the same explanation under its roles.
- **Not a bracket finding:** going over the tutor target never moves the bracket estimate or turns the header badge amber; it's a role like Ramp.

### Data model changes (migration 0033, applied Nov 7, 2026)

| Change | What | Why |
| --- | --- | --- |
| `decks.cutter` jsonb, default `{}` | `{ locks: [oracle_id], dismissed: {oracle_id: reason or ""}, archetype: {key, status: auto / confirmed / picked, rejected: [keys]}, curve: {oracle_id: "curve" or "cheat"}, h2h: [[winner, loser], …] (newest 300) }` | Per-deck state, like `suggest_settings`. Read defensively by `readCutterState`; saved half a second after a change, not part of Ctrl+Z (like sliders). Returned by `deck_bundle`; never shown to shared viewers |
| `profiles.cutter_prefs` jsonb, default `{}` | `{ power: bool, weights: {...}, comboProtect: true, belowTargetWarning: true, cutsToMaybe: false, archetypes: [custom profiles] }` | Per-user settings, set on `/settings` (and the weights inside the Cutter). Returned by `deck_bundle`'s profile |
| `card_summaries.instant_speed` | Appended to the view: front face is an Instant, or its oracle text has Flash | "Weakest in role" speed. `oracle_text` is in `cards` but not sent to the browser today |
| `deck_change_log.label` and `note` text + `apply_deck_changes(…, p_notes jsonb)` (**migration 0034, applied Nov 7, 2026**) | The function stores `{label, cards: {oracle_id: reason}}` in a transaction-local setting; the change-log trigger copies the label and each card's reason | The Timeline shows "Smart Cutter" with each cut's reason. Autosave also retries without the notes if a database lacks 0034, so deploy order can't break Apply |
| No new board | `deck_cards.board` check stays as it is | David's choice: the floor lives only on the Cutter screen |

### Code layout

- `src/lib/cutter/config.ts`: weights, thresholds (overness divisor 3, theme count 15, cheat enablers 4 and mana value 6, mana strain 20%, shortlist 3, tie margin 0.01).
- `src/lib/cutter/archetypes.ts`: the starter set (data only).
- `src/lib/cutter/archetype.ts`: `detectArchetypes(deck)` (ranked, with evidence), `cheatTargets`, `effectiveCurve`.
- `src/lib/cutter/score.ts`: `keepScores(ctx)` (components, flags, why facts), `protectedReason(card)` (lock, combo, a role would drop below target, commander, land, no tags), `planCuts(ctx, n)` (one at a time, re-scoring), `belowTargetWarning(deck, cards)` for the editor's removal paths.
- `src/lib/cutter/explain.ts`: why facts → plain sentences.
- `src/lib/cutter/swaps.ts`: one-for-one and 2-for-1 swap candidates on top of `suggestion_pool` + `scorePool`.
- Hooks: `use-cutter-state.ts` (deck), `use-cutter-prefs.ts` (profile).
- UI in `src/app/decks/[id]/`: `cutter-panel.tsx` (overlay: archetype label, shortlist or fills, floor, Apply / Discard), `cutter-card.tsx`, `cutter-why.tsx`; power user `cutter-walkthrough.tsx`, `cutter-head-to-head.tsx`, `cutter-what-if.tsx`; `src/app/settings/cutter-setting.tsx`. Entry point: **Cut** in `deck-hero.tsx` (a gold "Cut N" when the deck is over 100), plus More → Smart Cutter. Owner only.
- Tests (vitest): every `src/lib/cutter` module, with the Omo deck (`docs/test-data/omo-moxfield-plain.txt`) and small made-up decks (reanimator with fatties, over-target Ramp, a combo pair, a lone under-target wipe).

### Build order

Default mode first, power user after. Each step ends usable.

1. **C1 Engine + data (built Nov 7, 2026):** migration 0033 (0031 and 0032 went to other features), config, archetypes, detection, effective curve, keep score, guardrails, `planCuts`, all tested. No UI yet; check the results on Omo and the 10 QA decks with David.
2. **C1b Tutors role (built Nov 7, 2026):** `except` on roles, the Tutors role and its bracket defaults, slider follows the bracket until moved, Tutor label and explanation in the editor and card sheet, tests. No migration (targets already live in `decks.role_targets`).
3. **C2 Cutter screen (built Nov 7, 2026):** overlay, archetype label with the Yes / No flow, shortlist for over 100, "why" pop-up, cutting-room floor (kept across a refresh), Restore, Apply as one `Change` with notes (remove, or to the maybeboard), Discard prompt, lock and dismiss.
4. **C3 (built Nov 7, 2026) Exactly 100 / under 100 + editor guardrails:** 3 weakest with swaps, fill-the-gaps view linking to Suggest, 🔒 in the card sheet and on rows / tiles, below-target warning on every manual removal path, its setting.
5. **C4 Power user basics (built Nov 7, 2026):** Settings toggle, weight sliders, dismiss reasons, combo protection switch, curve overrides, custom archetypes editor.
6. **C5 Power user tools (built Nov 7, 2026):** walkthrough, head to head, 2-for-1 swaps, what-if preview.
7. **C6 Tuning pass (first round Nov 7, 2026):** compare cuts against how David would cut Omo and two QA decks; tune curves and weights; phone check.

**Quality check notes and tuning (Nov 8, 2026):**
- **Ramp counts:** the QA decks really do run 22-33 ramp cards (mostly mana rocks), so the Cutter is right to aim at Ramp. Path to Exile and Erode stay in Ramp as well as Removal: they can target your own creature to ramp you (David, Nov 8, 2026).
- **Fixed, cheap cards and the curve:** buckets 0-1 and 2 are never penalized (`curveFreeBuckets`), so Preordain is no longer suggested in spellslinger decks; the "why" says cheap cards never count against it.
- **Fixed, color fixing:** in decks of 3+ colors, a ramp card that makes 2+ of the deck's colors gets 2 flexibility points (`fixingPoints`). Chromatic Lantern moved from about 3rd to 9th-10th weakest Ramp card in Atraxa and Kenrith.
- **Fixed, free spells:** cards tagged `full-refund` (Frantic Search) rank as mana value 0 within their role.
- **Fixed, swaps:** a swap never adds to a role already at or over target, other than the cut card's own roles (Omo's Card advantage cuts now swap for draw cards, not Migration Path or Solemn Simulacrum).
- **Popularity gets a weight (David, Nov 8, 2026: "staples are staples for a reason"):** a sixth keep-score part, 12% by default (EDHREC rank on a log scale); the others became coverage 25, saturation 20, weakest 20, theme 15, curve 8. It shows in the "why" ("EDHREC rank #46: a staple") and as a power-user slider. In a deck made only of staples (the QA decks: every Kenrith nonland card is in the top 122) one of them still has to be suggested; in real decks with pet cards it protects staples.
- **Tutors hidden by default (David, Nov 8, 2026):** the role stays, but every deck starts with it hidden (`HIDDEN_BY_DEFAULT` in `role-settings.ts`); "Show" under Hidden roles stores `"hide:tutors": 0` and the bracket-based target applies from then on.

### Open questions and risks

| Topic | Issue | Proposal |
| --- | --- | --- |
| Protection can leave little to cut | With the below-target rule, a 100-card deck with every role exactly on target protects every card in a role; only theme cards and cards whose roles are all over target remain | Say so plainly: "Every role card holds a role at its target. Raise a target or lower one to free cards up", and still list the weakest theme cards |
| Tag gaps for archetypes | No tag for voltron, Equipment or Aura (those are type lines), +1/+1 specifically (`counters-matter` covers every counter type), cascade (a keyword, not a tag), or a solid enchantress tag (`enchantment-engine` has 22 cards). `hate` (4,706) is too broad to signal stax on its own | Mix tags with type-line counts and deck facts (as the table does); a test keeps every slug real; tune with real decks |
| Curves are guesses | No source data for curve per archetype | Start with the table, tune in C6; power users override |
| Good-stuff decks | Atraxa, Kenrith, Niv-Mizzet and Tymna detect as Control / stax (counterspells and tax pieces are common in staples) | David, Nov 7, 2026: leave it; the Yes / No question corrects it |
| Ramp role is very wide | In the QA decks Ramp counts 23-33 cards against a target of 10, because Scryfall's `ramp` tree includes cost reducers, sac outlets and mana fixers (Ashnod's Altar, Thought Vessel, Chromatic Lantern). Most suggested cuts are then ramp cards | Found in the C6 check, Nov 7, 2026. A role definition question for David, not a Cutter change |
| Same swap offered twice | At exactly 100 the first version offered one card (Solemn Simulacrum) as the swap for all three weakest | Fixed: a card offered once isn't offered again |
| Overlap of coverage and theme fit | With themes selected, a theme-heavy card scores in both | Accepted by David; coverage counts breadth (how many jobs), theme fit counts centrality (how core the themes are). Watch in C6 |
| Untagged / new cards | ~200 legal cards have no tags; new cards get tags only after the nightly import | Never suggested, flagged "No tags yet" |
| Swap pool speed | `suggestion_pool` takes 0.3-0.5 s warm and up to ~8 s on a cold database | Load swaps after the shortlist shows; retry once on timeout (as Suggest does) |
| Engine speed | 100 cards × 5 components, re-scored after each cut: well under 50 ms even for 20 cuts | Measure in C1 on a 140-card list |
| Deck edited elsewhere while cutting | The floor is saved per tab; the deck may change in another tab | On open, drop floor cards no longer on the mainboard and re-score |
| Multiple copies | Basics are lands (skipped); "any number" cards (Relentless Rats) | Suggest one copy at a time |
| Head-to-head data | Grows with use | Keep the newest 300 results per deck |
| Shared decks | Viewers can't edit | No Cutter for viewers; locks not shown to them |

### Future (not in V2)

- **V3:** "Build your first deck" guide that explains every tool, including adjusting role target sliders.
- **Later:** land count recommendations and land cuts; playtester flags (`decks.playtest_flags`, "dead card" feedback) feeding the keep score; an automatic version snapshot before applying cuts; collection-aware cuts (needs collection tracking).

## Technical architecture

```
Scryfall bulk files ──► Daily import job ──► Database (Supabase Postgres) ◄──► Web app (Next.js on Vercel) ◄──► Browser
(oracle cards,          (runs once a day,    (cards, tags, tag links,          (editor, playtester)            (builder's screen,
 oracle tags,            rebuilds cards        decks, users)                                                     drag from Scryfall)
 art tags)               and tags)                  ▲
Commander Spellbook ─────────┘                      │
(combo data for bracket checks)              Sign-in (Discord or Google, Supabase Auth)
```

The browser talks only to the web app, and the web app reads only its own database, so building never waits on Scryfall. Two things go to Scryfall directly: card images load from Scryfall's image servers, and the live `otag:` fallback runs for cards not yet in the database.

**Stack:** Next.js and TypeScript for the web app, hosted on Vercel; Supabase for the database and sign-in; the daily import as a scheduled job. All three have free tiers that cover testing.

## Pain points research

Done Oct 18, 2026, from each site's own feedback board (vote counts) and a 2026 comparison review. Reddit blocks automated reading, so it isn't included. The strongest validation: Archidekt users asked for cards to be auto-categorized from Scryfall oracle tags, which is this app's core idea.

| Pain point | Evidence | Status here |
| --- | --- | --- |
| No deck version history | Moxfield #2 request, 592 votes, in progress; Archidekt shipped changelogs in 2022 (332 points) | **v1, step 3h:** Version history |
| Search shows cards already in the deck | Moxfield #3, 307 votes | Search marks them with a count (built in 2d). **v1, step 3e:** add the Hide toggle |
| No bulk edits | Moxfield #5, 255 votes | **v1, step 3g:** Bulk edit |
| Categories too flat | Archidekt subcategories, 240 points | **v1, step 3e:** Role subgroups from the tag tree |
| Sections can't collapse | Moxfield, 136 votes | Built (3a): collapsible group headings |
| Slows down on big lists | Archidekt large lists, 507 points (slow past about 200 cards); Moxfield loading past about 150 | **v1 requirement:** Big-list performance (measured in 3e, re-checked before the friend test) |
| Search waits about 1 s per keystroke | Moxfield instant-search request | Quick add uses our own indexed database (2b); keep it under about 150 ms |
| Re-tagging the same card in every deck | Archidekt auto-categories, 43 points; users asked for Scryfall oracle tags | Core design (roles from tags), plus account-wide My tags (3e) |
| No combo detection | Moxfield #6, 207 votes (Commander Spellbook) | Planned in phase 5, bracket targeting |
| Deck price ignores cheaper printings | Moxfield, 161 votes | Built: a card with no chosen printing counts at its cheapest printing; a chosen one at its real price |
| Mobile: overlapping buttons, keyboard stays open, no drag, lost work | Archidekt forum, 2020 and 2022 | Built: card sheet with large buttons, whole card is the tap target, autosave. Check that the keyboard closes after Quick add on phones |
| Ads cover cards in the playtester | Moxfield feedback board | Planned: the playtester never shows ads |
| Playtester is clunky: cards shift, the battlefield clutters | 2026 review of Archidekt | Design rule for phase 6: cards stay where you put them; lands and tokens group automatically |
| Collection tracking is weak | Moxfield #1, 624 votes | On the v2 backlog |
| Print-friendly export; native mobile app | Moxfield, 165 and 140 votes | Out of scope for v1 |

**Sources:** [Moxfield top requests](https://moxfield.nolt.io/top) · [Moxfield instant search](https://moxfield.nolt.io/1181) · [Moxfield loading issues](https://moxfield.nolt.io/1201) · [Moxfield playtest ads](https://moxfield.nolt.io/1645) · [Archidekt changelogs](https://archidekt.com/forum/thread/2320849/1) · [Archidekt large decks](https://archidekt.com/forum/thread/2377567/1) · [Archidekt slowdown](https://archidekt.com/forum/thread/10643647?orderBy=-points&page=1) · [Archidekt subcategories](https://archidekt.com/forum/thread/3298946) · [Archidekt auto-categories](https://archidekt.com/forum/thread/4173294/1) · [Archidekt mobile critique](https://archidekt.com/forum/thread/418475) · [Archidekt phone usability](https://archidekt.com/forum/thread/2324250) · [Grimdeck 2026 comparison](https://grimdeck.com/blog/best-mtg-deck-builder-sites)

## Suggestion check against EDHREC (Oct 19, 2026)

The spec's success test, run on the Omo test deck (overall suggestions, top 24) against EDHREC's Omo page (13,232 decks).

| | First run (as ported) | After the fix |
| --- | --- | --- |
| Best fit | 14/24 also on EDHREC, 10 new. Good picks, plus a few pulled in by vague tags | 13/24 on EDHREC, 11 new: Urborg, Reflections of Littjara, Chronicle of Victory, Snap / Rewind / Unwind, all real Omo synergies EDHREC doesn't list |
| Hidden gems | 22/24 new, mostly filler (Reckless Pangolin, Street Sweeper) matched on one vague tag | No filler; 15 picks, each sharing 2+ themes |

**Fix (David chose "both"):** vague tags (unique type line, multiple targets, attacking matters-self, repeatable crime, per-player, donate token, plus the ability kinds activated / triggered ability) no longer count as themes, and Hidden gems needs 2+ shared themes.

**Still open:** Hidden gems now overlaps Best fit a lot (few rarely-played cards share two themes), and "single target instant/sorcery" is broad and drives several picks. Worth revisiting with the friend test.

## Prototype findings

The single-page prototype (`prototype/tag-deck-builder.html`) confirmed the core bet: on a Meren deck, tag-based suggestions surfaced on-theme cards like Yahenni, Erebos and Nemata, with clear reasons on each.

| Finding | What it changes in the build |
| --- | --- |
| Scryfall's tag files are JSONL (one tag per line), and the listing names the link `jsonl_download_uri` | The import job reads JSONL and looks for either link field |
| A browser page can't download the bulk tag files directly, but can call Scryfall's search API | Tag files must be downloaded by the server's daily job, never by the browser |
| Tags form a tree (about 4,600 parent links), but each card is tagged at one level only | Store parent links; Broad mode rolls tags up to their parents |
| Broad tags like *activated ability* crowd the theme list | **Specific** mode keeps every tag but lists the deepest first; **Broad** rolls up; a Sort switch picks Relevance or Count |
| Some oracle tags describe names and wording, not gameplay | A **Gameplay / Flavor** switch; Flavor adds art tags (keyed by illustration) |
| Generic tags still slip through | Each user can hide tags, saved to their profile |
| A hover card showing the tag's tree (parents, the tag, its subtags with deck counts) makes the tree understandable | Keep it in the full app |

Decided in testing: default role targets don't change with bracket, and each user can save their own default targets.

## Build phases & risks

Build in this order. Each phase ends with something usable, so the tool is worth testing early.

1. **Data foundation:** build the daily import (oracle tags, art tags, card data) and load the cards and tags tables.
2. **Core editor:** search, quick add, import/export, drag from Scryfall, sign-in, autosave.
3. **Tag layer:** auto-categories, role profile and sliders, top-tags panel.
4. **Suggestions:** candidate pool, scoring, the four ranking styles, a "why" on each pick.
5. **Bracket targeting:** checks, alerts, estimated-bracket badge, filtered suggestions.
6. **Playtester:** zones, mulligans, shortcuts, flags, opening-hand stats.
7. **Friend test:** share links, a feedback button, fixes from the first round.

**Risks**

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Tag file format changes | The whole design depends on it | Parse defensively (JSON or JSONL, either link field); fall back to cached live `otag:` searches |
| Uneven tag quality | Obscure cards can be under-tagged, so they'd never get suggested | Let builders assign roles by hand; flag untagged cards in the deck |
| Scryfall terms | Attribution and rate limits apply to all their data and images | Credit Scryfall on every page; use bulk data, not repeated API calls |
| Fan Content Policy | Decides whether ads are allowed if it goes public | Check the current policy before any public launch |
| Playtester size | The largest single feature; it could stall the rest | Built after the core is usable, as phase 6 |
