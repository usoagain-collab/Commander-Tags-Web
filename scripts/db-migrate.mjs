// Applies any SQL files in supabase/migrations that haven't run yet, each in its own transaction.
// Run: npm run db:migrate
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const dir = path.resolve("supabase/migrations");
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

await client.query(`create table if not exists public.schema_migrations (
  name text primary key, applied_at timestamptz not null default now())`);
await client.query(`alter table public.schema_migrations enable row level security`);
const applied = new Set((await client.query("select name from public.schema_migrations")).rows.map((r) => r.name));

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  console.log(`Applying ${file} ...`);
  try {
    await client.query("begin");
    await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
    await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    console.error(`Failed on ${file}; nothing from it was applied.`);
    throw err;
  }
}
console.log("Migrations up to date.");
await client.end();
