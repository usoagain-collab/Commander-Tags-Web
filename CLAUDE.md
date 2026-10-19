# Commander Tags Web

A Commander (EDH) deck builder where **Scryfall Tagger tags drive everything**: auto-categories, a role profile with target sliders, and card suggestions ranked by how well a card's tags fit the deck. The bet: suggesting cards by *function* (what a card does) beats EDHREC-style suggestions by *popularity*.

- Full feature spec: `docs/spec.md`, the source of truth for what to build.
- Working prototype: `prototype/tag-deck-builder.html`, a single HTML file with the tag logic already proven. Port its logic; don't re-invent it.

## Working with David (the owner)

- David is a mechanical engineer and HVAC account manager, not a professional developer. He's technical and learns fast. **Explain what you're doing, how, and why**, in plain language.
- When something is wrong, **say what the issue is and why it's an issue before fixing it**.
- Medium-length answers: a short summary first, then details he can dig into. No walls of text.
- He researches big decisions until he's comfortable. For choices that are hard to undo (schema, auth, hosting), lay out the options briefly and recommend one.
- Never commit secrets. Supabase keys go in `.env.local` (git-ignored). The service-role key is server-only and never reaches the browser.
- **Out-of-scope ideas: ask, don't decide.** When something outside v1 comes up, ask David whether it goes on the **v2 backlog** or is **not intended**, then record it in `docs/spec.md` (sections "v2 backlog" and "Not intended").
- Mobile matters: no small tap targets on top of card images (David found Moxfield's ⋯ buggy on phones). Make the whole card the tap target.

## Status

| Phase | State |
| --- | --- |
| Prototype (single HTML file) | Done. Tag file format, tag tree, role mapping and scoring all confirmed against real Scryfall data |
| 1. Data foundation | Done (merged Oct 18, 2026). Daily import runs from GitHub Actions at 22:30 UTC |
| 2. Core editor | Done (merged Oct 19, 2026): sign-in + decks, quick add / boards / autosave / undo, import/export, card search, drag from Scryfall |
| 3. Tag layer | **In progress**, one PR per step (plan agreed Oct 18, 2026, see "Phase 3 plan" below): 3a views + card panel + card sheet (merged), 3b card details (merged), **3c role profile** (built), 3d top tags, 3e **my tags** + manual category override, 3f stats |
| 4. Suggestions | Logic exists in the prototype; needs porting |
| 5. Bracket targeting | Not started |
| 6. Playtester | Not started |
| 7. Friend test | Not started |
| v2 | After v1 is fully working and friend-tested. Backlog lives in `docs/spec.md` → "v2 backlog" (printings, pricing details, foil, collection, wish list, change mana cost, preferred printing, multiplayer playtesting) |

## Phase 3 plan (agreed Oct 18, 2026)

- **Computed in the browser**, ported from the prototype into tested TypeScript modules. The **oracle tag tree** (about 4,600 tags and links) ships as one cached daily file; the deck's card tags (and art tags for its default illustrations) load per deck. Theme score N = distinct tagged cards (oracle) or illustrations (art), as in the prototype.
- **Layout (wide screens):** left = role profile + top tags; center = deck with a View / Group / Sort toolbar; right = sticky **card panel** (hovered card's image, the roles it fills, its oracle tags deepest first, its art tags; click a tag to highlight matching cards). Narrower screens fold the left column above the deck; phones open cards in a bottom sheet.
- **Views:** Text, Visual grid, Stacks. **Group:** Type, Role, Mana value, Color. **Sort:** Name, Mana value, Price. Saved per user (`profiles.tag_view`).
- **Card sheet:** tapping or clicking a card opens it immediately (image first) with big action buttons (commander, main/maybe, quantity, remove, add to another deck, copy name) and its tags; Prev / Next on desktop. Collapsible group headings with counts, quantity badges on tiles, summary bar (size, type counts, price).
- **Card details (3b):** rules text, P/T, faces, legality, rulings, fetched live from Scryfall; tags instead of buy links.
- **Built in 3a:** SQL `oracle_tag_tree()` (whole tree as one JSON value; the theme N values come from the latest `import_runs.counts.tagged_cards` / `tagged_illustrations`, which the importer now records) and `card_tags_for(ids)`. `/api/tag-tree` serves the tree with a one-day CDN cache. Logic: `src/lib/tags/tree.ts` (TagTree), `roles.ts` (STANDARD_ROLES, rolesOf), `src/lib/deck/grouping.ts`; hook `use-tag-data.ts`. UI: `deck-views.tsx` (Text / Grid / Stacks), `card-panel.tsx`, `card-sheet.tsx`, `card-tags.tsx`, `deck-toolbar.tsx`, `summary-bar.tsx`. Tests run with vitest (`vitest.config.mts` maps `@/`).
- **Built in 3b:** `src/lib/scryfall/card-details.ts` fetches a card live from Scryfall when its sheet opens (`/cards/search?q=oracleid:…`, then its `rulings_uri`), cached per visit, and normalizes it (faces, stats, legality with Commander first, rulings). `card-details.tsx` shows rules text per face (with `SymbolText`: mana symbols as icons, reminder text in italics), a Flip button when each face has its own image (modal/transforming DFCs; Rooms and split cards share one image), "✓ Legal in Commander", and collapsible "Legality in all formats" and "Rulings (N)".
- **Roles (3c):** dead slugs dropped. Ramp = ramp, mana-rock, mana-dork, land-ramp; Card advantage = card-advantage, draw; Targeted removal = removal, spot-removal (minus board wipes); Board wipes = sweeper; Protection = protection, gives-protection, protects-permanent, gives-hexproof, gives-indestructible; Recursion = recursion. Slider changes save after a short pause and are not part of Ctrl+Z.
- **Built in 3c:** SQL 0007 adds `layout` and `counts_as_land` to `card_summaries` (land front face, or a modal DFC with a land face; transform cards don't count). MDFCs fill Lands **and** their spell roles; the summary bar shows "Land N (incl. M MDFC)". Type display order is Creature, Artifact, Enchantment, Sorcery, Instant, Planeswalker, Battle, Other, **Land last** (`TYPE_DISPLAY_ORDER`; `TYPE_SECTIONS` is only filing precedence); Group by Role puts Lands last too. Card advantage has `notVia`: when a card is also Ramp, the "onto the battlefield" tags (consult-onto-battlefield, impulse-onto-battlefield, impulse-land, land-or-hand) don't count toward it, so land-fetchers count as Ramp only (David, Oct 19, 2026). Role profile (`role-profile.tsx`): bars, sliders (max 30, Lands 50), ⓘ explanations (hover on desktop, tap on phones), click a role to highlight its cards, Save as my defaults / Reset, custom roles from any tag. Settings in `src/lib/tags/role-settings.ts` and `use-role-settings.ts` (saved to `decks.role_targets` / `custom_roles`).
- **From the pain points research (decided Oct 18, 2026; see `docs/spec.md` → "Pain points research"):** four additions to v1, not yet scheduled into steps. Plan where each goes with David:
  - **Role subgroups** in 3d: Group by Role splits each role into its subtags using the tag tree.
  - **Bulk edit** fits with 3e: multi-select, then move, tag, set quantity or remove, as one `Change`.
  - **Search toggle:** hide cards already in the deck (the count badge stays).
  - **Version history:** saved deck versions, a diff, and restore as a normal undoable `Change`.
  - Also a **v1 performance requirement**: a 100-card deck plus a 300-card maybeboard with no lag (draw only what's on screen).
- **My tags (3e, decided Oct 19, 2026):** user-made labels on cards, several per card, deck-only or account-wide. **Account-wide = the tag and its card assignments follow the card into every deck** (option A). Toggleable (Show my tags), Group by My tags, highlight, rename / recolor / scope / delete. Needs two private tables (tags; tag-to-card assignments with an optional deck_id); show David the schema before creating it.

The GitHub repository is connected to a Supabase project and a Vercel project. Ask David for keys when you need them; he enters secrets himself.

- **Vercel needs the env vars too**: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Production and Preview). Without them every page fails, because the middleware creates a Supabase client on each request.
- `NEXT_PUBLIC_SUPABASE_URL` is the bare project address (`https://<ref>.supabase.co`), **not** the `/rest/v1/` API URL. With the suffix, database calls still work but sign-in breaks.
- `vercel.json` sets `framework: nextjs`, because the Vercel project was created as "Other".

## Stack (decided)

- **Next.js + TypeScript**, hosted on **Vercel** (free tier).
- **Supabase**: Postgres plus Auth (Discord and Google sign-in), with row-level security on every user table.
- **Daily import job**: a scheduled server job, never in the browser. Decided Oct 17, 2026:
  - Runs as a **GitHub Actions scheduled workflow**. Vercel's free tier kills functions after about 60 s, which is too short for a full load.
  - Loads with a **direct Postgres connection and `COPY`** (`SUPABASE_DB_URL`), not the Supabase REST API.
  - **Tag tables rebuild inside one transaction** (clear, reload, commit) so removed tags disappear and readers never see a half-load. `cards` is upserted, because decks reference `oracle_id`.
- Node.js 24 LTS. Supabase clients live in `src/lib/supabase/` (`client.ts` browser, `server.ts` per-user server, `admin.ts` service role, server-only).
- Card images load straight from Scryfall's image CDN. Credit Scryfall on every page.

## Phase 2 decisions (Oct 18, 2026)

- **Decks are normalized**: `decks` plus `deck_cards` (one row per card per board: `commander`, `main`, `maybe`, `companion`), not a JSON blob. Schema in `supabase/migrations/0003_profiles_decks.sql`.
- **RLS**: owners have full access to their own profile, decks and deck cards; anyone can read `public` decks. **Unlisted decks have no open read policy** (it would let anyone list them all); share links (Phase 7) go through a server route that fetches one deck by id.
- **Card search**: the browser calls Scryfall's search API directly (full syntax), then joins results to our DB by `oracle_id` for tags. Quick add and `otag:` autocomplete use our own DB.
- **Sign-in**: Discord first (working locally), Google next. A profile row is created automatically on first sign-in.
- **Printing picker deferred**: `deck_cards.printing_id` exists (null = default). Slim the `cards` rows before loading all printings.
- **Editor (2b)**: pure deck logic in `src/lib/deck/model.ts` (tested in `model.test.ts`, run `npm test`). Every edit is a `Change` of row counts (from → to), so undo/redo is exact and autosave sends the same rows. Autosave (`use-autosave.ts`) queues edits in order through the `apply_deck_changes` SQL function (one transaction per edit, RLS applies); a failed save stops the queue and shows Retry.
- **Copy limits** come from the `card_summaries` view (`max_copies`: basics and "any number" 99, Seven Dwarves 7, Nazgûl 9, else 1). Commander/companion boards hold 1. Quick add uses `search_cards()` (trigram index, Commander-legal only).
- Card images and mana symbols load from Scryfall's CDN with plain `<img>` (ESLint's no-img-element is off on purpose).
- **Import/export (2c)**: `src/lib/deck/text-format.ts` parses pasted lists (headers, set codes, `1x`, Archidekt `[Commander]` tags, MTGO trailing commander, `SB:`) and exports Moxfield/Archidekt/MTGO/Arena/plain; round-trip tested. Names resolve in one call via `resolve_card_names()` (case- and accent-insensitive, front face of split/DFC cards). A whole import is one `Change`, so one Ctrl+Z reverts it. MTGO has no companion slot: a companion exported to MTGO re-imports as a second commander.
- **Card search (2d)**: `card-search.tsx` sends full Scryfall syntax from the browser (CORS allowed). `buildQuery` in `src/lib/search/query.ts` adds `id<=<commander colors>`, `f:commander` and `game:paper` unless the user already wrote them, and wraps the user's part in parentheses so a top-level `or` can't bypass the filters. Results are matched to `card_summaries` by `oracle_id`; cards not in our data yet can't be added (deck_cards has a foreign key). Scryfall's `warnings` are shown. `otag:`/`function:`/`art:` autocomplete reads our `tags` table.
- **Drag from Scryfall (2e)**: `src/lib/drop/scryfall-drop.ts` reads a drop (Scryfall card id from the image URL, set/number from the card page link, or the name from alt/plain text); `resolve.ts` turns it into a `CardSummary` (Scryfall API for ids, `resolve_card_names` for names). The deck page shows a drop overlay (main / maybe / commander; elsewhere = main). Each deck in My decks is a drop target that adds to its mainboard with the same rules. Missed drops are blocked so the browser doesn't open the dragged link. The dropped printing isn't stored yet (printing picker is later).
- **Don't run `npm run build` while `npm run dev` is running**: both write `.next/`, and the dev server loses its CSS. Stop dev, build, `rm -rf .next`, restart dev.
- **Test deck: "Omo test deck"** (commander Omo, Queen of Vesuva; Simic lands; 100 cards) in David's account, id `7364f160-46e9-4365-a779-53969cc0f445`, at `/decks/7364f160-46e9-4365-a779-53969cc0f445`. Its source list is `docs/test-data/omo-moxfield-plain.txt` (Moxfield plain-text export, also used by unit tests). Use it for browser testing and screenshots, not Meren (David's preference, Oct 18, 2026).
- Moxfield's plain-text export writes Room/split names with a single slash ("Walk-In Closet/Forgotten Cellar"); the parser turns any `/`, `//` or `///` into " // ".
- Local dev: `npm run dev` (http://localhost:3000; must be port 3000 for sign-in redirects). Supabase redirect URLs include `http://localhost:3000/**` and the Vercel preview pattern.

## Scryfall data facts (learned the hard way in the prototype)

- **Bulk list**: `GET https://api.scryfall.com/bulk-data`. Use types `oracle_cards`, `oracle_tags` and `art_tags`.
- **Tag files are JSONL** (one JSON object per line), possibly gzip-compressed (first bytes `1f 8b`). The listing may name the link `jsonl_download_uri` rather than `download_uri`. Check both and handle both formats.
- **Browsers can't download bulk files** (CORS), but they can call the search API. All bulk downloads happen in the server job.
- **Tag object**: `{ id, slug, label, type, description?, aliases?, parent_ids?, child_ids?, taggings: [{ oracle_id | illustration_id, weight, annotation? }] }`.
  - Oracle tags key on `oracle_id`, shared by every printing of a card.
  - Art tags key on `illustration_id`, so they're printing-specific. Use the deck's chosen printing.
  - Art tags have `type: "illustration"` in the file; we store them as `kind = 'art'`.
- **The tag tree** exists (24,477 links in Oct 2026, mostly in the art-tag tree; the prototype's ~4,600 was oracle-only) and may be stored as `parent_ids`, `child_ids` or both. Merge both directions. **Each card is tagged at ONE level only**: a card with *death trigger* is not also tagged *triggered ability*. Parents are implied.
- **Search syntax**: `otag:<slug>` for oracle tags, `art:<slug>` for art tags, plus `id<=BG f:commander game:paper`, `order=edhrec`. A search with no results returns HTTP 404; treat it as empty.
- **Rate limit**: stay at or under 10 requests a second (the prototype waits 110 ms between calls). Send `Accept` and a descriptive `User-Agent` from the server.
- **Popularity**: `edhrec_rank` is on every card object, so EDHREC itself never needs scraping. Today's price is `prices.usd`, refreshed daily; there's no price history.

## Data layer (Phase 1)

- Schema: `supabase/migrations/` (numbered SQL files). Apply with `npm run db:migrate`; it records what ran in `schema_migrations`.
- Import: `npm run import` runs `scripts/import-scryfall.mts` (about 1.5 minutes). Every run logs counts to `import_runs`.
- Saved queries for the Supabase SQL editor: `supabase/queries/row-counts.sql` and `card-tags.sql` (tags for one card).
- First load: 38,753 cards; 4,578 oracle tags; 11,637 art tags; 24,477 tag links; 236,840 card tags; 497,762 illustration tags. Nothing skipped.
- **Database size is about 322 MB of the 500 MB free cap.** Roughly half of that is the previous day's copy, which Postgres keeps and reuses, so it holds steady instead of growing. Before adding all printings (Phase 2), slim the `cards` row: `legalities` and `image_uris` are most of it.
- **Role slugs not in the data** (Oct 2026): `card-draw`, `creature-removal`, `board-wipe`, `wrath`, `mass-removal`, `reanimation`, `graveyard-recursion`. Every role still works through its root tag (`draw`, `removal`, `sweeper`, `recursion` and so on) plus descendants. Drop the dead slugs when porting in Phase 3.

## Logic to port from the prototype

Find these in `prototype/tag-deck-builder.html`:

- **Roles** (`STANDARD_ROLES`): each role maps to tag slugs and includes all descendant tags. Lands come from the type line. Targeted removal excludes cards that are board wipes. Defaults: Lands 37, Ramp 10, Card advantage 10, Targeted removal 8, Board wipes 3, Protection 3, Recursion 2. Default targets don't change with bracket; each user can save their own defaults, and add a custom role from any tag.
- **Theme tags** (`themeTags`): count tags across nonland cards (commander counts double and is pinned), excluding role tags. Score = count × ln(1 + N / tag size). Commander tags show first.
- **Gameplay / Flavor switch**: Gameplay = oracle tags minus wording/name tags. Flavor = art tags plus wording/name oracle tags (`FLAVOR_ORACLE`, `isFlavorOracle`). Always hidden: `MECHANIC_NOISE` (static, keyword and mana ability, vanilla variants).
- **Specific / Broad switch**: Specific = tags exactly as applied, listed deepest first. Broad = also roll each tag up to all its ancestors. **Never drop a tag in Specific**; David explicitly rejected that.
- **Sort switch**: Relevance (the score) or Count (raw hits). It picks the top 24; Specific then reorders by depth.
- **Tag tree hover card**: parents, then the tag (highlighted), then its subtags, with in-deck counts.
- **Hidden tags**: a user can hide any tag. Store keys as `o:<slug>` or `a:<slug>` and save them per user.
- **Suggestions** (`suggest`, `scorePool`): the pool comes from Scryfall search for the clicked role or tag, in the commander's color identity, pages 1–2 by EDHREC rank plus the least-played end. Fit = shared theme-tag weight (normalized) + 0.12 per under-target role filled. Styles:
  - **Best fit:** 0.6 fit + 0.4 popularity.
  - **Hidden gems:** 0.65 fit + 0.35 (1 − popularity).
  - **Budget:** fit and popularity, plus a price cap.
  - **Custom:** sliders for each factor.
  - Every suggestion shows *why* (shared tags, roles filled).

## First session: Phase 1, data foundation

Goal: the database holds every card and every tag, refreshed daily.

1. Scaffold the Next.js + TypeScript app with a Supabase client. Add `.env.local.example` listing the needed variables, with no values.
2. Design the schema and explain it to David before creating it. At minimum:
   - `cards`: oracle_id, name, type line, mana value, color identity, legality, `edhrec_rank`, `prices.usd`, image URIs, default `illustration_id`.
   - `tags`: id, slug, label, kind (`oracle` or `art`), size.
   - `tag_links`: parent to child.
   - `card_tags`: oracle_id to tag.
   - `illustration_tags`: illustration_id to tag.
3. Write the import job: download the three bulk files, parse JSONL or JSON, gzip or not, and load them in batches. Make it safe to re-run (upsert or swap tables).
4. Run it once locally and report the counts: cards, oracle tags, art tags, links.
5. Verify the role slugs in `STANDARD_ROLES` exist in the data, and report any that don't.
6. Leave the daily schedule (Vercel cron or Supabase scheduled function) described, ready to switch on once the app is deployed.

Done means David can see the row counts and look up the tags for "Sol Ring" with one query.
