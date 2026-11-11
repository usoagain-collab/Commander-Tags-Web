// Read-only check of the wording chips on real commanders: prints each commander's phrases and how many
// Commander-legal cards in its colors say each one (through cards_with_wording, migration 0048).
// Run: npm run wording:check [names...]   (defaults to the 25 most played commanders)
import pg from "pg";
import { wordingPhrases } from "@/lib/search/wording";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const names = process.argv.slice(2);
const { rows } = await client.query(
  names.length
    ? `select name, type_line, oracle_text, color_identity from cards where name = any($1)`
    : `select name, type_line, oracle_text, color_identity from cards
       where commander_legal and type_line ilike '%legendary%creature%' and edhrec_rank is not null
       order by edhrec_rank limit 25`,
  names.length ? [names] : [],
);
for (const c of rows) {
  const phrases = wordingPhrases(c.oracle_text ?? "", c.name, c.type_line);
  const counts = new Map<string, number>();
  if (phrases.length) {
    const r = await client.query(`select unnest(matched) p, count(*)::int n from cards_with_wording($1, $2, 2000) group by 1`, [phrases, c.color_identity]);
    for (const x of r.rows) counts.set(x.p, x.n);
  }
  console.log(`\n${c.name} (${c.color_identity.join("") || "C"})`);
  for (const p of phrases) console.log(`  ${String(counts.get(p) ?? 0).padStart(5)}  ${p}`);
  if (!phrases.length) console.log("  (no phrases)");
}
await client.end();
