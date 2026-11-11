// Measures a rules-text search on our side before we commit to it (Nov 10, 2026).
// Everything lives in a TEMP table, so nothing in the database changes; it is gone when the script ends.
// Run: node --env-file=.env.local scripts/measure-wording.mjs
import pg from "pg";

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error("SUPABASE_DB_URL is not set in .env.local");

const PHRASES = [
  "whenever a land you control enters",
  "return a land you control to its owner's hand",
  "sacrifice a creature",
  "whenever a creature you control dies",
  "create a 1/1",
  "put a +1/+1 counter on",
  "whenever you gain life",
  "discard a card",
  "you may play an additional land",
  "exile target creature you control, then return",
  "when ~ enters",
  "whenever you cast an instant or sorcery spell",
];

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const q = async (sql, params) => (await client.query(sql, params)).rows;
const time = async (label, sql, params) => {
  const t = performance.now();
  const rows = await q(sql, params);
  console.log(`${label.padEnd(52)} ${(performance.now() - t).toFixed(0).padStart(5)} ms  ${rows.length} rows`);
  return rows;
};

console.log((await q(`select pg_size_pretty(pg_database_size(current_database())) as db_size`))[0]);

// The card name (each face of a split or double-faced card) becomes ~, as in Scryfall syntax.
await time("build temp table", `
  create temp table wording as
  select c.oracle_id, c.color_identity, c.commander_legal, c.edhrec_rank,
         lower(coalesce(c.oracle_text, '')) as t, lower(c.name) as name
  from cards c`);
// Full name, then each face, then a legend's short name ("Omo" for "Omo, Queen of Vesuva").
const swap = (part) => `update wording set t = replace(t, ${part}, '~') where coalesce(${part}, '') <> ''`;
await time("swap full names for ~", swap("name"));
await time("swap face 1 names for ~", swap("nullif(split_part(name, ' // ', 1), name)"));
await time("swap face 2 names for ~", swap("nullif(split_part(name, ' // ', 2), '')"));
await time("swap short legend names for ~", swap("nullif(split_part(split_part(name, ' // ', 1), ',', 1), split_part(name, ' // ', 1))"));
console.log(await q(`select name, t from wording where name like 'omo, queen%' or name = 'sol ring'`));

const [{ n, text_size }] = await q(`select count(*) n, pg_size_pretty(sum(octet_length(t))) text_size from wording`);
console.log({ cards: n, text_size });

await time("create trigram index", `create extension if not exists pg_trgm with schema extensions`);
await time("create trigram index (gin)", `create index wording_trgm on wording using gin (t extensions.gin_trgm_ops)`);
await q(`analyze wording`);
console.log(await q(`select pg_size_pretty(pg_relation_size('wording_trgm')) as index_size,
                            pg_size_pretty(pg_relation_size('wording')) as table_size`));

console.log("\nOne phrase at a time (warm), Simic identity, Commander-legal:");
for (const p of PHRASES) {
  await time(p, `select oracle_id from wording where t like '%' || $1 || '%' and commander_legal
                 and color_identity <@ array['G','U']`, [p]);
}

console.log("\nAll phrases in one call, which phrase each card matched:");
await time("12 phrases, any color", `
  select w.oracle_id, array_agg(p) from wording w
  join unnest($1::text[]) p on w.t like '%' || p || '%'
  where w.commander_legal group by w.oracle_id`, [PHRASES]);

const plan = await q(`explain (analyze, buffers) select oracle_id from wording where t like '%sacrifice a creature%'`);
console.log("\nPlan for one phrase:\n" + plan.map((r) => r["QUERY PLAN"]).join("\n"));

await client.end();
