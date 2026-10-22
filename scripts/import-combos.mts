// Daily two-card combo import from Commander Spellbook (Phase 5a, bracket targeting).
//
// Run locally:  npm run import:combos
// In CI:        the daily GitHub Actions workflow runs it right after the Scryfall import (combos point at cards).
//
// Spellbook publishes every combo as one JSON file (~700 MB). It is streamed, never held in memory, and only
// TRUE two-card combos are kept: exactly two named cards, one copy each, status OK, legal in Commander, and both
// cards already in our cards table. Combos that also need a generic piece ("any sacrifice outlet") are kept with
// their count in `requires`; the bracket rules decide whether they count.
//
// Safe to re-run: the combos table is cleared and reloaded inside ONE transaction, like the tag tables.
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import pg from "pg";

const require = createRequire(import.meta.url);
const { parser } = require("stream-json") as typeof import("stream-json");
const { pick } = require("stream-json/filters/Pick") as typeof import("stream-json/filters/Pick");
const { streamArray } = require("stream-json/streamers/StreamArray") as typeof import("stream-json/streamers/StreamArray");

const SOURCE = "https://json.commanderspellbook.com/variants.json";
const USER_AGENT = "CommanderTagsWeb/0.1 (daily combo import; github.com/usoagain-collab/Commander-Tags-Web)";

type Use = { card?: { oracleId?: string | null; name?: string }; quantity?: number };
type Variant = {
  id: string;
  status?: string;
  uses?: Use[];
  requires?: { quantity?: number }[];
  produces?: { feature?: { name?: string } }[];
  bracketTag?: string | null;
  popularity?: number | null;
  legalities?: { commander?: boolean };
};
type Row = { id: string; a: string; b: string; results: string[]; tag: string | null; requires: number; popularity: number | null };

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is not set (see .env.local.example)");
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
const run = await client.query<{ id: string }>("insert into public.import_runs (source) values ('combos') returning id");
const runId = run.rows[0].id;

try {
  const known = new Set((await client.query<{ oracle_id: string }>("select oracle_id from public.cards")).rows.map((r) => r.oracle_id));
  const counts = { variants: 0, two_card: 0, kept: 0, skipped_unknown_card: 0, skipped_not_legal: 0, with_requirements: 0, by_tag: {} as Record<string, number> };
  const rows: Row[] = [];

  console.log(`Downloading ${SOURCE} …`);
  const res = await fetch(SOURCE, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok || !res.body) throw new Error(`GET ${SOURCE} -> HTTP ${res.status}`);
  const stream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream).pipe(parser()).pipe(pick({ filter: "variants" })).pipe(streamArray());

  for await (const { value } of stream as AsyncIterable<{ value: Variant }>) {
    counts.variants++;
    const uses = value.uses ?? [];
    if (value.status !== "OK" || uses.length !== 2 || uses.some((u) => (u.quantity ?? 1) !== 1)) continue;
    const ids = uses.map((u) => u.card?.oracleId ?? "");
    if (!ids[0] || !ids[1] || ids[0] === ids[1]) continue;
    counts.two_card++;
    if (value.legalities?.commander === false) {
      counts.skipped_not_legal++;
      continue;
    }
    if (!known.has(ids[0]) || !known.has(ids[1])) {
      counts.skipped_unknown_card++;
      continue;
    }
    const [a, b] = ids[0] < ids[1] ? [ids[0], ids[1]] : [ids[1], ids[0]];
    const requires = (value.requires ?? []).reduce((n, r) => n + (r.quantity ?? 1), 0);
    if (requires) counts.with_requirements++;
    const tag = value.bracketTag ?? null;
    counts.by_tag[tag ?? "none"] = (counts.by_tag[tag ?? "none"] ?? 0) + 1;
    rows.push({
      id: value.id,
      a,
      b,
      results: (value.produces ?? []).map((p) => p.feature?.name).filter((n): n is string => !!n).slice(0, 3),
      tag,
      requires,
      popularity: typeof value.popularity === "number" ? value.popularity : null,
    });
    if (counts.variants % 20000 === 0) console.log(`  …${counts.variants.toLocaleString()} combos read, ${rows.length.toLocaleString()} kept`);
  }
  counts.kept = rows.length;

  // Replace the table in one transaction: readers keep the old combos until it commits.
  await client.query("begin");
  await client.query("delete from public.combos");
  for (let i = 0; i < rows.length; i += 2000) {
    const batch = rows.slice(i, i + 2000);
    await client.query(
      // results travel as JSON (lists of different lengths can't share one 2-D array), then become text[].
      `insert into public.combos (id, card_a, card_b, results, bracket_tag, requires, popularity)
       select id, a, b, array(select jsonb_array_elements_text(results)), tag, req, pop
       from unnest($1::text[], $2::uuid[], $3::uuid[], $4::jsonb[], $5::text[], $6::int[], $7::int[])
         as t(id, a, b, results, tag, req, pop)
       on conflict (id) do nothing`,
      [
        batch.map((r) => r.id),
        batch.map((r) => r.a),
        batch.map((r) => r.b),
        batch.map((r) => JSON.stringify(r.results)),
        batch.map((r) => r.tag),
        batch.map((r) => r.requires),
        batch.map((r) => r.popularity),
      ],
    );
  }
  await client.query("commit");

  await client.query("update public.import_runs set status = 'succeeded', finished_at = now(), counts = $2 where id = $1", [runId, counts]);
  console.log("Done:", counts);
} catch (err) {
  await client.query("rollback").catch(() => undefined);
  await client.query("update public.import_runs set status = 'failed', finished_at = now(), error = $2 where id = $1", [runId, String(err)]);
  throw err;
} finally {
  await client.end();
}
