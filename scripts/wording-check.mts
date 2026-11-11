// Read-only check of wording on real commanders: each commander's chips and the phrases overall Suggest searches
// for (its own wording plus mirror phrases), with how many Commander-legal cards in its colors say each one
// (cards_with_wording, migration 0048). With --mirrors, counts every mirror phrase across all colors instead.
// Run: npm run wording:check [names...]   (defaults to the 25 most played commanders)
import pg from "pg";
import { wordingPhrases } from "@/lib/search/wording";
import { MIRRORS, wordingPlan } from "@/lib/search/wording-pairs";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const counts = async (phrases: string[], identity: string[] | null) => {
  const r = await client.query(`select unnest(matched) p, count(*)::int n from cards_with_wording($1, $2, 2000) group by 1`, [phrases, identity]);
  return new Map<string, number>(r.rows.map((x) => [x.p, x.n]));
};

if (process.argv.includes("--mirrors")) {
  const all = [...new Set(MIRRORS.flatMap((m) => m.also))];
  const found = new Map<string, number>();
  for (let i = 0; i < all.length; i += 24) for (const [p, n] of await counts(all.slice(i, i + 24), null)) found.set(p, n);
  for (const p of all) console.log(`${String(found.get(p) ?? 0).padStart(6)}  ${p}`);
} else {
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
    const chips = wordingPhrases(c.oracle_text ?? "", c.name, c.type_line);
    const plan = wordingPlan([{ name: c.name, type_line: c.type_line, text: c.oracle_text ?? "" }]);
    const found = plan.phrases.length || chips.length ? await counts([...new Set([...chips, ...plan.phrases])], c.color_identity) : new Map();
    console.log(`\n${c.name} (${c.color_identity.join("") || "C"})`);
    for (const p of chips) console.log(`  chip   ${String(found.get(p) ?? 0).padStart(5)}  ${p}`);
    for (const p of plan.phrases.filter((x) => !chips.includes(x))) console.log(`  feeds  ${String(found.get(p) ?? 0).padStart(5)}  ${p}  (${plan.why[p]})`);
    if (!chips.length && !plan.phrases.length) console.log("  (no phrases)");
  }
}
await client.end();
