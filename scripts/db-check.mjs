// Checks that SUPABASE_DB_URL connects, without printing any secret.
// Run: node --env-file=.env.local scripts/db-check.mjs
import pg from "pg";

const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error("SUPABASE_DB_URL is not set in .env.local");

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(
  `select current_user, version(), pg_size_pretty(pg_database_size(current_database())) as db_size,
          (select count(*) from information_schema.tables where table_schema = 'public') as public_tables`,
);
console.log(rows[0]);
await client.end();
