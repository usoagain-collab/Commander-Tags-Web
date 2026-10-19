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

## Status

| Phase | State |
| --- | --- |
| Prototype (single HTML file) | Done. Tag file format, tag tree, role mapping and scoring all confirmed against real Scryfall data |
| 1. Data foundation | Done (merged Oct 18, 2026). Daily import runs from GitHub Actions at 22:30 UTC |
| 2. Core editor | **In progress**, one PR per step: 2a sign-in + decks (merged), 2b editor basics (merged), **2c import/export** (built), 2d card search, 2e drag from Scryfall |
| 3. Tag layer (roles, sliders, top tags) | Logic exists in the prototype; needs porting |
| 4. Suggestions | Logic exists in the prototype; needs porting |
| 5. Bracket targeting | Not started |
| 6. Playtester | Not started |
| 7. Friend test | Not started |

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
- **Don't run `npm run build` while `npm run dev` is running**: both write `.next/`, and the dev server loses its CSS. Stop dev, build, `rm -rf .next`, restart dev.
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
