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
- **Alerts:** a banner names what crossed the line ("Adds a 2-card combo: Card A + Card B") and the card gets a badge. Nothing is blocked; the builder decides.
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
| Pricing | Today's price per card and the deck total (USD), from Scryfall's daily data | Asked for; no history needed |
| ~~Printing picker~~ | **Moved to v2** (Oct 18, 2026). v1 uses each card's default printing and its art tags | Standard |
| Card sheet | Tap or click any card (name in text view, image in visual views) to open it straight away: big image, large action buttons, its roles and tags. A bottom sheet on phones, a window with Prev / Next on desktop. No tiny icons on top of card images | Moxfield's ⋯ on the image is hard to hit on mobile |
| Card details | Rules text, P/T or loyalty, both faces, legality in every format, and rulings, fetched live from Scryfall. The card's tags take the place of buy links | Asked for; tags are this app's point |
| My tags | Your own labels on cards ("Combo", "Win con"…), several per card, added from the card sheet. Each is **this deck only** or **account-wide**: an account-wide tag and where it's applied follow the card into every deck (tag Sol Ring "Staple" once, it's a Staple everywhere). A "Show my tags" switch, Group by My tags, click to highlight, rename / recolor / change scope / delete | Moxfield-style tags, asked for by David (Oct 19, 2026) |
| Tokens list | Tokens the deck can create | Standard, helps playtesting |
| Share link | Read-only link; decks are private, unlisted or public | Needed for friend tests |
| Autosave | Every change saves instantly; undo with Ctrl+Z | Feels good to use |
| Version history | Every deck keeps saved versions. See what changed between two versions (added / removed cards), and restore an old one. Restoring is itself a change, so it can be undone | Moxfield's #2 request (592 votes); Archidekt has it. Added Oct 18, 2026 |
| Bulk edit | Select several cards (checkboxes or Shift-click), then move them to another board, add or remove a My tag, change quantity or remove them, all at once and as one Ctrl+Z | Moxfield's #5 request (255 votes). Added Oct 18, 2026 |
| Role subgroups | With Group by Role, each role splits into its subtags (Ramp › mana rocks, mana dorks, land ramp), using the tag tree; each subgroup collapses | Archidekt subcategories request (240 points). Added Oct 18, 2026; 3d merged first, so it needs a new step |
| Big-list performance | A 100-card deck plus a 300-card maybeboard stays smooth: long lists draw only what's on screen | Both sites slow down past about 150–200 cards |

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
| Card printings | Printing picker and switching printings in a deck (stored in `deck_cards.printing_id`); art tags follow the chosen printing | Oct 18, 2026 |
| Preferred printing | Remember a favourite printing per card across all your decks (needs printings) | Oct 18, 2026 |
| Pricing details | Foil vs. normal price, prices per store, price settings, price per printing (v1 keeps today's single price per card and the deck total) | Oct 18, 2026 |
| Foil version | Mark a card in a deck as foil | Oct 18, 2026 |
| Collection tracking | Ownership checkmarks, "add to collection", the "unowned" price total (also listed under Out of scope for v1) | Oct 18, 2026 |
| Wish list | Cards you want to buy, separate from any deck | Oct 18, 2026 |
| Change mana cost | Override a card's displayed mana cost for stats (e.g. X spells) | Oct 18, 2026 |
| Multiplayer playtesting | Playtest against other players (v1's playtester is solo goldfish, phase 6) | Oct 18, 2026 |

## Not intended

Considered and deliberately left out of this project.

- Moxfield's custom formats (Archon, Highlander variants and so on): Moxfield's own rules, with no Scryfall data behind them.

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
| No deck version history | Moxfield #2 request, 592 votes, in progress; Archidekt shipped changelogs in 2022 (332 points) | **v1** (David, Oct 18, 2026): Version history |
| Search shows cards already in the deck | Moxfield #3, 307 votes | Search marks them with a count (built in 2d). **v1:** add the Hide toggle |
| No bulk edits | Moxfield #5, 255 votes | **v1:** Bulk edit |
| Categories too flat | Archidekt subcategories, 240 points | **v1:** Role subgroups from the tag tree (step to be set; 3d merged first) |
| Sections can't collapse | Moxfield, 136 votes | Built (3a): collapsible group headings |
| Slows down on big lists | Archidekt large lists, 507 points (slow past about 200 cards); Moxfield loading past about 150 | **v1 requirement:** Big-list performance |
| Search waits about 1 s per keystroke | Moxfield instant-search request | Quick add uses our own indexed database (2b); keep it under about 150 ms |
| Re-tagging the same card in every deck | Archidekt auto-categories, 43 points; users asked for Scryfall oracle tags | Core design (roles from tags), plus account-wide My tags (3e) |
| No combo detection | Moxfield #6, 207 votes (Commander Spellbook) | Planned in phase 5, bracket targeting |
| Deck price ignores cheaper printings | Moxfield, 161 votes | Not decided. Needs printings, which are on the v2 backlog |
| Mobile: overlapping buttons, keyboard stays open, no drag, lost work | Archidekt forum, 2020 and 2022 | Built: card sheet with large buttons, whole card is the tap target, autosave. Check that the keyboard closes after Quick add on phones |
| Ads cover cards in the playtester | Moxfield feedback board | Planned: the playtester never shows ads |
| Playtester is clunky: cards shift, the battlefield clutters | 2026 review of Archidekt | Design rule for phase 6: cards stay where you put them; lands and tokens group automatically |
| Collection tracking is weak | Moxfield #1, 624 votes | On the v2 backlog |
| Print-friendly export; native mobile app | Moxfield, 165 and 140 votes | Out of scope for v1 |

**Sources:** [Moxfield top requests](https://moxfield.nolt.io/top) · [Moxfield instant search](https://moxfield.nolt.io/1181) · [Moxfield loading issues](https://moxfield.nolt.io/1201) · [Moxfield playtest ads](https://moxfield.nolt.io/1645) · [Archidekt changelogs](https://archidekt.com/forum/thread/2320849/1) · [Archidekt large decks](https://archidekt.com/forum/thread/2377567/1) · [Archidekt slowdown](https://archidekt.com/forum/thread/10643647?orderBy=-points&page=1) · [Archidekt subcategories](https://archidekt.com/forum/thread/3298946) · [Archidekt auto-categories](https://archidekt.com/forum/thread/4173294/1) · [Archidekt mobile critique](https://archidekt.com/forum/thread/418475) · [Archidekt phone usability](https://archidekt.com/forum/thread/2324250) · [Grimdeck 2026 comparison](https://grimdeck.com/blog/best-mtg-deck-builder-sites)

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
