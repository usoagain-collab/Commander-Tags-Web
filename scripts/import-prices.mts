// Nightly store prices from MTGJSON (v2, Nov 11, 2026; docs/spec.md → "Prices from MTGJSON", option A).
//
// Locally:  npm run import:prices          (add --no-trend to skip the 90-day file, which takes a few minutes)
// In CI:    the daily GitHub Actions workflow runs it after the Scryfall import, because it adds to the prices that
//           import writes (TCGplayer stays Scryfall's price; this adds Card Kingdom, Mana Pool and Cardmarket).
//
// Steps: read MTGJSON id → Scryfall id (csv/cardIdentifiers.csv.gz, 15 MB), today's prices (AllPricesToday, 6 MB)
// and, for the 7- and 30-day trend, the 90-day file (AllPrices, 148 MB, streamed and thrown away). Writes:
//   cards.store_prices / price_trend          the cheapest printing per store, and the TCGplayer trend
//   printing_info.stores                      exact prices for printings in decks, defaults, collections, splits
//   deck_price_history                        each deck's total for every price source, today (not precons)
// Nothing here can break the site: a failed run leaves yesterday's numbers, and the import is logged in import_runs.
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import pg from "pg";
import { addToTrend, cheapestStores, identifierColumns, printingStores, trendOf, type MtgjsonCardPrices, type TrendAcc } from "@/lib/prices/mtgjson";
import type { StorePrices } from "@/lib/deck/store-prices";
import { deckTotals } from "@/lib/deck/deck-totals";
import { entryKey, type Board, type CardSummary, type Entries, type Printings, type PreferredPrintings } from "@/lib/deck/model";
import { readSplit, type Splits } from "@/lib/deck/splits";
import type { ChosenPrinting } from "@/lib/deck/printing";

const require = createRequire(import.meta.url);
const { parser } = require("stream-json") as typeof import("stream-json");
const { pick } = require("stream-json/filters/Pick") as typeof import("stream-json/filters/Pick");
const { streamObject } = require("stream-json/streamers/StreamObject") as typeof import("stream-json/streamers/StreamObject");

const BASE = "https://mtgjson.com/api/v5";
const USER_AGENT = "DeckGenome/1.0 (nightly price import)";
const withTrend = !process.argv.includes("--no-trend");
const HISTORY_DAYS = 400;

const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

async function gzStream(path: string) {
  const res = await fetch(`${BASE}/${path}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  const raw = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  // fetch unpacks Content-Encoding gzip itself; a .gz file served as plain bytes still needs unpacking.
  return res.headers.get("content-encoding") ? raw : raw.pipe(createGunzip());
}

async function readText(path: string) {
  const chunks: Buffer[] = [];
  for await (const c of await gzStream(path)) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error("SUPABASE_DB_URL is not set");
const client = new pg.Client({ connectionString: url });
await client.connect();
const run = await client.query<{ id: string }>("insert into public.import_runs (source) values ('prices') returning id");
const runId = run.rows[0].id;

try {
  // 1. MTGJSON id -> Scryfall printing id and oracle id.
  log("Reading cardIdentifiers.csv ...");
  const ids = new Map<string, { printing: string; oracle: string }>();
  let cols: ReturnType<typeof identifierColumns> | null = null;
  for await (const line of createInterface({ input: await gzStream("csv/cardIdentifiers.csv.gz") })) {
    if (!cols) {
      cols = identifierColumns(line);
      continue;
    }
    const f = line.split(",").map((c) => c.replace(/"/g, ""));
    if (f[cols.scryfall] && f[cols.oracle]) ids.set(f[cols.uuid], { printing: f[cols.scryfall], oracle: f[cols.oracle] });
  }
  log(`  ${ids.size} printings matched to Scryfall`);

  // 2. Today's prices: exact ones for printings in use, cheapest per card for the rest.
  log("Reading AllPricesToday ...");
  const today = JSON.parse(await readText("AllPricesToday.json.gz")) as { meta: { date: string }; data: Record<string, MtgjsonCardPrices> };
  const day = today.meta.date;
  const inUse = new Set(
    (
      await client.query<{ id: string }>(
        `select printing_id::text as id from public.deck_cards where printing_id is not null
         union select printing_id::text from public.preferred_printings
         union select printing_id::text from public.collection_cards where printing_id is not null
         union select (e->'printing'->>'id') from public.deck_cards, jsonb_array_elements(printing_split) e where jsonb_typeof(printing_split) = 'array'`,
      )
    ).rows.map((r) => r.id),
  );
  const exact = new Map<string, StorePrices>();
  const perCard = new Map<string, StorePrices[]>();
  for (const [uuid, prices] of Object.entries(today.data)) {
    const id = ids.get(uuid);
    if (!id) continue;
    const stores = printingStores(prices);
    if (!stores) continue;
    if (inUse.has(id.printing)) exact.set(id.printing, stores);
    const list = perCard.get(id.oracle);
    if (list) list.push(stores);
    else perCard.set(id.oracle, [stores]);
  }
  log(`  ${day}: ${perCard.size} cards and ${exact.size} of ${inUse.size} printings in use have store prices`);

  // 3. Trend from the 90-day file (optional; a failure keeps yesterday's trend).
  const trends = new Map<string, TrendAcc>();
  if (withTrend) {
    try {
      log("Streaming AllPrices for the 7- and 30-day trend ...");
      const stream = (await gzStream("AllPrices.json.gz")).pipe(parser()).pipe(pick({ filter: "data" })).pipe(streamObject());
      let n = 0;
      for await (const { key, value } of stream as AsyncIterable<{ key: string; value: MtgjsonCardPrices }>) {
        const id = ids.get(key);
        if (!id) continue;
        let acc = trends.get(id.oracle);
        if (!acc) trends.set(id.oracle, (acc = {}));
        addToTrend(acc, value, day);
        if (++n % 20000 === 0) log(`  ${n} printings read`);
      }
      log(`  trend for ${trends.size} cards`);
    } catch (e) {
      trends.clear();
      log(`  Couldn't read AllPrices, keeping yesterday's trend: ${e}`);
    }
  }

  // 4. Cards: store prices and trend.
  const cardRows = [...new Set([...perCard.keys(), ...trends.keys()])].map((oracle) => ({
    oracle_id: oracle,
    store_prices: cheapestStores(perCard.get(oracle) ?? []) ?? null,
    price_trend: trends.size ? (trendOf(trends.get(oracle) ?? {}) ?? null) : undefined,
  }));
  await client.query("begin");
  await client.query("create temp table tmp_card_prices (oracle_id uuid primary key, store_prices jsonb, price_trend jsonb, has_trend boolean) on commit drop");
  for (let i = 0; i < cardRows.length; i += 2000) {
    await client.query(
      `insert into tmp_card_prices select r.oracle_id, r.store_prices, r.price_trend, r.has_trend
       from jsonb_to_recordset($1::jsonb) as r(oracle_id uuid, store_prices jsonb, price_trend jsonb, has_trend boolean)`,
      [JSON.stringify(cardRows.slice(i, i + 2000).map((r) => ({ ...r, has_trend: r.price_trend !== undefined, price_trend: r.price_trend ?? null })))],
    );
  }
  const cardsUpdated = await client.query(
    `update public.cards c set store_prices = t.store_prices, price_trend = case when t.has_trend then t.price_trend else c.price_trend end
     from tmp_card_prices t
     where c.oracle_id = t.oracle_id
       and (c.store_prices is distinct from t.store_prices or (t.has_trend and c.price_trend is distinct from t.price_trend))`,
  );
  // Cards MTGJSON no longer prices lose their store prices (and the trend, when this run read it).
  const cleared = await client.query(
    `update public.cards c set store_prices = null, price_trend = case when $1 then null else c.price_trend end
     where (c.store_prices is not null or ($1 and c.price_trend is not null))
       and not exists (select 1 from tmp_card_prices t where t.oracle_id = c.oracle_id)`,
    [trends.size > 0],
  );
  await client.query("commit");
  log(`  ${cardsUpdated.rowCount} cards updated, ${cleared.rowCount} cleared`);

  // 5. Exact printings. Own short transaction with the touch trigger off, like the Scryfall import's reprice, so a
  //    price change doesn't make every deck look edited.
  const printingRows = JSON.stringify([...exact].map(([id, stores]) => ({ id, stores })));
  await client.query("begin");
  await client.query("create temp table tmp_printing_stores (id uuid primary key, stores jsonb) on commit drop");
  await client.query("insert into tmp_printing_stores select r.id, r.stores from jsonb_to_recordset($1::jsonb) as r(id uuid, stores jsonb)", [printingRows]);
  await client.query("alter table public.deck_cards disable trigger deck_cards_touch");
  const deckRows = await client.query(
    `update public.deck_cards c set printing_info = c.printing_info || jsonb_build_object('stores', t.stores)
     from tmp_printing_stores t
     where c.printing_id = t.id and c.printing_info is not null and c.printing_info->'stores' is distinct from t.stores`,
  );
  const splitRows = await client.query(
    `update public.deck_cards c set printing_split = s.split
     from (
       select c2.deck_id, c2.oracle_id, c2.board,
         jsonb_agg(case when t.stores is null then e else jsonb_set(e, '{printing,stores}', t.stores) end order by x.ord) as split
       from public.deck_cards c2
       cross join lateral jsonb_array_elements(c2.printing_split) with ordinality as x(e, ord)
       left join tmp_printing_stores t on t.id::text = x.e->'printing'->>'id'
       where jsonb_typeof(c2.printing_split) = 'array'
       group by c2.deck_id, c2.oracle_id, c2.board
     ) s
     where c.deck_id = s.deck_id and c.oracle_id = s.oracle_id and c.board = s.board and c.printing_split is distinct from s.split`,
  );
  await client.query("alter table public.deck_cards enable trigger deck_cards_touch");
  const defaults = await client.query(
    `update public.preferred_printings c set printing_info = c.printing_info || jsonb_build_object('stores', t.stores)
     from tmp_printing_stores t where c.printing_id = t.id and c.printing_info->'stores' is distinct from t.stores`,
  );
  const owned = await client.query(
    `update public.collection_cards c set printing_info = c.printing_info || jsonb_build_object('stores', t.stores)
     from tmp_printing_stores t where c.printing_id = t.id and c.printing_info is not null and c.printing_info->'stores' is distinct from t.stores`,
  );
  await client.query("commit");
  log(`  printings: ${deckRows.rowCount} deck rows, ${splitRows.rowCount} mixed rows, ${defaults.rowCount} defaults, ${owned.rowCount} owned`);

  // 6. Each deck's total for every source, today. Precons are left out (nobody's own deck; they'd be most rows).
  const decks = await client.query<{ id: string; owner_id: string }>("select id, owner_id from public.decks where precon is null");
  const rows = await client.query<{ deck_id: string; oracle_id: string; board: Board; quantity: number; printing_id: string | null; foil: boolean; printing_info: Record<string, unknown> | null; printing_split: unknown }>(
    `select dc.deck_id, dc.oracle_id, dc.board, dc.quantity, dc.printing_id, dc.foil, dc.printing_info, dc.printing_split
     from public.deck_cards dc join public.decks d on d.id = dc.deck_id
     where d.precon is null and dc.board in ('commander', 'main', 'companion')`,
  );
  const oracleIds = [...new Set(rows.rows.map((r) => r.oracle_id))];
  const cards: Record<string, CardSummary> = {};
  for (const r of (await client.query<{ oracle_id: string; price_usd: string | null; store_prices: StorePrices | null }>("select oracle_id, price_usd, store_prices from public.cards where oracle_id = any($1::uuid[])", [oracleIds])).rows)
    cards[r.oracle_id] = { oracle_id: r.oracle_id, price_usd: r.price_usd == null ? null : Number(r.price_usd), store_prices: r.store_prices } as CardSummary;
  const preferredByOwner = new Map<string, PreferredPrintings>();
  for (const r of (await client.query<{ owner_id: string; oracle_id: string; printing_id: string; printing_info: Record<string, unknown> }>("select owner_id, oracle_id, printing_id, printing_info from public.preferred_printings")).rows) {
    const m = preferredByOwner.get(r.owner_id) ?? {};
    m[r.oracle_id] = { ...r.printing_info, id: r.printing_id, foil: false } as ChosenPrinting;
    preferredByOwner.set(r.owner_id, m);
  }
  const byDeck = new Map<string, typeof rows.rows>();
  for (const r of rows.rows) byDeck.set(r.deck_id, [...(byDeck.get(r.deck_id) ?? []), r]);
  const history = decks.rows.flatMap((d) => {
    const list = byDeck.get(d.id);
    if (!list?.length) return [];
    const entries: Entries = {};
    const printings: Printings = {};
    const splits: Splits = {};
    for (const r of list) {
      const k = entryKey(r.board, r.oracle_id);
      entries[k] = r.quantity;
      if (r.printing_id && r.printing_info) printings[k] = { ...r.printing_info, id: r.printing_id, foil: r.foil } as ChosenPrinting;
      const split = readSplit(r.printing_split);
      if (split) splits[k] = split;
    }
    return [{ deck_id: d.id, totals: deckTotals(entries, cards, printings, preferredByOwner.get(d.owner_id) ?? {}, splits) }];
  });
  await client.query(
    `insert into public.deck_price_history (deck_id, day, totals)
     select r.deck_id, $2::date, r.totals from jsonb_to_recordset($1::jsonb) as r(deck_id uuid, totals jsonb)
     on conflict (deck_id, day) do update set totals = excluded.totals`,
    [JSON.stringify(history), day],
  );
  const pruned = await client.query("delete from public.deck_price_history where day < $1::date - $2::int", [day, HISTORY_DAYS]);
  log(`  deck price history: ${history.length} decks for ${day}, ${pruned.rowCount} old rows removed`);

  // Most cards rows were just rewritten. Until a vacuum marks their pages clean, suggestion_pool can't use its
  // index-only scan (migration 0043) and a cold Suggest times out; it also lets tomorrow's rows reuse the space.
  await client.query("vacuum (analyze) public.cards").catch((e) => log(`  vacuum cards skipped: ${e instanceof Error ? e.message : e}`));
  await client.query("vacuum (analyze) public.deck_cards").catch((e) => log(`  vacuum deck_cards skipped: ${e instanceof Error ? e.message : e}`));

  const counts = { day, printings_matched: ids.size, cards_priced: perCard.size, cards_updated: cardsUpdated.rowCount, trends: trends.size, printings_in_use: inUse.size, printings_priced: exact.size, decks: history.length };
  await client.query("update public.import_runs set status = 'succeeded', finished_at = now(), counts = $2 where id = $1", [runId, counts]);
  log(`Done: ${JSON.stringify(counts)}`);
} catch (err) {
  await client.query("rollback").catch(() => {});
  await client.query("update public.import_runs set status = 'failed', finished_at = now(), error = $2 where id = $1", [runId, String(err)]);
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}
