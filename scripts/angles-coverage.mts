// Read-only: how many Other angles commanders get (own wording + mirror pairs), for the most played commanders and
// for a fixed sample of rarely played ones (EDHREC rank 1,000+, every 25th by rank, so runs compare).
// Run: node --env-file=.env.local scripts/run-ts.mjs scripts/angles-coverage.mts [top] [rare] [--misses] [--show name]
import pg from "pg";
import { wordingPlan } from "@/lib/search/wording-pairs";

const args = process.argv.slice(2);
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const [top = 200, rare = 150] = nums;
const show = args.includes("--show") ? args[args.indexOf("--show") + 1] : null;
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const COMMANDERS = `commander_legal and type_line ilike '%legendary%creature%' and edhrec_rank is not null`;
const groups: [string, { name: string; type_line: string; oracle_text: string | null }[]][] = [
  [`Top ${top}`, (await client.query(`select name, type_line, oracle_text from cards where ${COMMANDERS} order by edhrec_rank limit $1`, [top])).rows],
  [
    `Rarely played (${rare}, rank 1,000+)`,
    (
      await client.query(
        `select name, type_line, oracle_text from (
           select name, type_line, oracle_text, row_number() over (order by edhrec_rank) r from cards where ${COMMANDERS} and edhrec_rank > 1000
         ) x where r % 25 = 0 order by r limit $1`,
        [rare],
      )
    ).rows,
  ],
];

if (show) {
  const { rows } = await client.query(`select name, type_line, oracle_text from cards where name ilike $1 order by length(name) limit 1`, [`${show}%`]);
  const c = rows[0];
  const plan = wordingPlan([{ name: c.name, type_line: c.type_line, text: c.oracle_text ?? "" }]);
  console.log(c.name, "\n", c.oracle_text, "\n");
  for (const a of plan.angles) console.log(`  ${a.name}: ${a.phrases.join(" | ")}`);
} else {
  for (const [label, rows] of groups) {
    const byMirrors = new Map<number, number>();
    const pairUse = new Map<string, number>();
    const none: { name: string; text: string }[] = [];
    for (const c of rows) {
      const plan = wordingPlan([{ name: c.name, type_line: c.type_line, text: c.oracle_text ?? "" }]);
      const mirrors = plan.angles.filter((a) => !a.key.startsWith("Same wording"));
      byMirrors.set(mirrors.length, (byMirrors.get(mirrors.length) ?? 0) + 1);
      for (const a of mirrors) pairUse.set(a.name, (pairUse.get(a.name) ?? 0) + 1);
      if (args.includes("--list") && mirrors.length) console.log(`  + ${c.name}: ${mirrors.map((a) => a.name).join(", ")}`);
      if (!mirrors.length) none.push({ name: c.name, text: (c.oracle_text ?? "").replace(/\n/g, " / ") });
    }
    const covered = rows.length - (byMirrors.get(0) ?? 0);
    console.log(`\n=== ${label}: ${covered} of ${rows.length} (${Math.round((100 * covered) / rows.length)}%) get a "feeds it" angle`);
    console.log("  by count: " + [...byMirrors].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}: ${v}`).join(", "));
    console.log("  pairs: " + [...pairUse].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
    if (args.includes("--misses")) for (const m of none) console.log(`  - ${m.name}: ${m.text.slice(0, 220)}`);
  }
}
await client.end();
