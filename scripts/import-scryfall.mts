// Daily Scryfall import: downloads Oracle Cards, Oracle Tags and Art Tags, then loads them into Postgres.
//
// Run locally:  npm run import
// In CI:        the GitHub Actions workflow runs the same command with SUPABASE_DB_URL as a secret.
//
// How it stays safe to re-run:
//   - cards are upserted (decks reference oracle_id, so cards are never deleted);
//   - tags, tag_links, card_tags and illustration_tags are deleted and reloaded inside ONE transaction.
//     Until it commits, every reader keeps seeing the previous data; if anything fails, it rolls back.
import { gunzipSync } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import pg from "pg";
import { from as copyFrom } from "pg-copy-streams";

const USER_AGENT = "CommanderTagsWeb/0.1 (daily bulk import; github.com/usoagain-collab/Commander-Tags-Web)";

type BulkEntry = { type: string; download_uri?: string; jsonl_download_uri?: string; updated_at: string };
type Face = { image_uris?: Record<string, string>; illustration_id?: string; type_line?: string; oracle_text?: string; mana_cost?: string };
type ScryfallCard = {
  oracle_id?: string; name: string; layout: string; mana_cost?: string; cmc?: number; type_line?: string;
  oracle_text?: string; color_identity?: string[]; legalities?: Record<string, string>; games?: string[];
  edhrec_rank?: number; prices?: { usd?: string | null }; image_uris?: Record<string, string>;
  illustration_id?: string; card_faces?: Face[]; game_changer?: boolean; produced_mana?: string[];
};
type Tagging = { oracle_id?: string; illustration_id?: string; weight?: string; annotation?: string | null };
type ScryfallTag = {
  id: string; slug: string; label: string; type: string; description?: string | null; aliases?: string[];
  parent_ids?: string[]; child_ids?: string[]; taggings?: Tagging[];
};

// ---------- download & parse ----------

async function scryfallJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Downloads a bulk file and returns its records. Handles gzip or plain, JSONL or a JSON array. */
async function downloadRecords<T>(entry: BulkEntry): Promise<T[]> {
  const url = entry.jsonl_download_uri ?? entry.download_uri;
  if (!url) throw new Error(`Bulk entry ${entry.type} has no download link`);
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf); // gzip magic bytes
  const text = buf.toString("utf8").trimStart();
  if (text.startsWith("[")) return JSON.parse(text) as T[];
  return text.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as T);
}

// ---------- CSV encoding for COPY ----------

type Cell = string | number | boolean | null | undefined;

const pgArray = (items: string[] | undefined) =>
  `{${(items ?? []).map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

const csvCell = (v: Cell) => {
  if (v === null || v === undefined) return ""; // unquoted empty = NULL
  const s = String(v);
  return `"${s.replace(/"/g, '""')}"`;
};

const csvRow = (cells: Cell[]) => cells.map(csvCell).join(",") + "\n";

async function copyRows(client: pg.PoolClient | pg.Client, table: string, columns: string[], rows: Cell[][]) {
  if (rows.length === 0) return;
  const sql = `copy ${table} (${columns.join(", ")}) from stdin with (format csv)`;
  const stream = client.query(copyFrom(sql));
  async function* lines() {
    for (const row of rows) yield csvRow(row);
  }
  await pipeline(Readable.from(lines()), stream);
}

// ---------- transform ----------

const IMAGE_SIZES = ["small", "normal", "large", "art_crop", "png"];

function pickImages(uris: Record<string, string> | undefined) {
  if (!uris) return null;
  return JSON.stringify(Object.fromEntries(IMAGE_SIZES.filter((k) => uris[k]).map((k) => [k, uris[k]])));
}

function joinFaces(card: ScryfallCard, key: "type_line" | "oracle_text" | "mana_cost", sep: string) {
  if (card[key] !== undefined) return card[key];
  const parts = (card.card_faces ?? []).map((f) => f[key]).filter((s): s is string => s !== undefined);
  return parts.length ? parts.join(sep) : null;
}

function cardRow(c: ScryfallCard): Cell[] {
  const front = c.card_faces?.[0];
  const price = c.prices?.usd;
  return [
    c.oracle_id,
    c.name,
    c.layout,
    joinFaces(c, "mana_cost", " // "),
    c.cmc ?? 0,
    joinFaces(c, "type_line", " // ") ?? "",
    joinFaces(c, "oracle_text", "\n//\n"),
    pgArray(c.color_identity),
    JSON.stringify(c.legalities ?? {}),
    pgArray(c.games),
    c.edhrec_rank ?? null,
    price ? Number(price) : null,
    pickImages(c.image_uris ?? front?.image_uris),
    c.illustration_id ?? front?.illustration_id ?? null,
    c.game_changer ?? false,
    pgArray(c.produced_mana),
  ];
}

const CARD_COLUMNS = [
  "oracle_id", "name", "layout", "mana_cost", "mana_value", "type_line", "oracle_text", "color_identity",
  "legalities", "games", "edhrec_rank", "price_usd", "image_uris", "default_illustration_id",
  "game_changer", "produced_mana",
];

// ---------- main ----------

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) throw new Error("SUPABASE_DB_URL is not set");
  const t0 = Date.now();
  const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const run = await client.query<{ id: string }>("insert into public.import_runs default values returning id");
  const runId = run.rows[0].id;

  try {
    // 1. Find today's files.
    const listing = await scryfallJson<{ data: BulkEntry[] }>("https://api.scryfall.com/bulk-data");
    const entry = (type: string) => {
      const e = listing.data.find((b) => b.type === type);
      if (!e) throw new Error(`Bulk type ${type} missing from Scryfall listing`);
      return e;
    };

    // 2. Download (sequentially: polite to Scryfall, and keeps memory lower).
    log("Downloading oracle_cards ...");
    const cards = (await downloadRecords<ScryfallCard>(entry("oracle_cards"))).filter((c) => c.oracle_id);
    log(`  ${cards.length} cards`);
    log("Downloading oracle_tags ...");
    const oracleTags = await downloadRecords<ScryfallTag>(entry("oracle_tags"));
    log(`  ${oracleTags.length} oracle tags`);
    log("Downloading art_tags ...");
    const artTags = await downloadRecords<ScryfallTag>(entry("art_tags"));
    log(`  ${artTags.length} art tags`);

    // 3. Build rows. Skip anything that would break a foreign key, and count what was skipped.
    const cardIds = new Set(cards.map((c) => c.oracle_id!));
    const allTags = [...oracleTags.map((t) => ({ t, kind: "oracle" })), ...artTags.map((t) => ({ t, kind: "art" }))];
    const tagIds = new Set(allTags.map(({ t }) => t.id));

    const tagRows: Cell[][] = [];
    const links = new Set<string>(); // "parent|child", merged from both directions
    const cardTagRows: Cell[][] = [];
    const illusTagRows: Cell[][] = [];
    const skipped = { card_tags_unknown_card: 0, links_unknown_tag: 0, duplicate_taggings: 0 };

    for (const { t, kind } of allTags) {
      tagRows.push([t.id, t.slug, t.label, kind, t.description ?? null, pgArray(t.aliases), t.taggings?.length ?? 0]);
      for (const p of t.parent_ids ?? []) {
        if (tagIds.has(p) && p !== t.id) links.add(`${p}|${t.id}`);
        else skipped.links_unknown_tag++;
      }
      for (const c of t.child_ids ?? []) {
        if (tagIds.has(c) && c !== t.id) links.add(`${t.id}|${c}`);
        else skipped.links_unknown_tag++;
      }
      const seen = new Set<string>();
      for (const g of t.taggings ?? []) {
        const key = kind === "oracle" ? g.oracle_id : g.illustration_id;
        if (!key) continue;
        if (seen.has(key)) { skipped.duplicate_taggings++; continue; }
        seen.add(key);
        if (kind === "oracle") {
          if (!cardIds.has(key)) { skipped.card_tags_unknown_card++; continue; }
          cardTagRows.push([key, t.id, g.weight ?? null, g.annotation ?? null]);
        } else {
          illusTagRows.push([key, t.id, g.weight ?? null, g.annotation ?? null]);
        }
      }
    }
    const linkRows = [...links].map((l) => l.split("|"));

    // 4. Load everything in one transaction.
    log("Loading into Postgres ...");
    await client.query("begin");

    await client.query(
      `create temp table cards_stage as select ${CARD_COLUMNS.join(", ")} from public.cards with no data`,
    );
    await copyRows(client, "cards_stage", CARD_COLUMNS, cards.map(cardRow));
    const updates = CARD_COLUMNS.filter((c) => c !== "oracle_id").map((c) => `${c} = excluded.${c}`).join(", ");
    await client.query(
      `insert into public.cards (${CARD_COLUMNS.join(", ")})
       select ${CARD_COLUMNS.join(", ")} from cards_stage
       on conflict (oracle_id) do update set ${updates}, updated_at = now()
       -- Only rewrite cards that actually changed: every rewrite leaves a dead row behind, which costs space.
       where (${CARD_COLUMNS.map((c) => `cards.${c}`).join(", ")})
             is distinct from (${CARD_COLUMNS.map((c) => `excluded.${c}`).join(", ")})`,
    );
    log(`  cards upserted`);

    // DELETE (not TRUNCATE) so readers aren't locked out while the new data loads.
    await client.query("delete from public.card_tags");
    await client.query("delete from public.illustration_tags");
    await client.query("delete from public.tag_links");
    await client.query("delete from public.tags");
    await copyRows(client, "public.tags", ["id", "slug", "label", "kind", "description", "aliases", "size"], tagRows);
    await copyRows(client, "public.tag_links", ["parent_id", "child_id"], linkRows);
    log(`  tags + links loaded`);
    await copyRows(client, "public.card_tags", ["oracle_id", "tag_id", "weight", "annotation"], cardTagRows);
    log(`  card_tags loaded`);
    await copyRows(client, "public.illustration_tags", ["illustration_id", "tag_id", "weight", "annotation"], illusTagRows);
    log(`  illustration_tags loaded`);

    await client.query("commit");

    const counts = {
      cards: cards.length,
      oracle_tags: oracleTags.length,
      art_tags: artTags.length,
      tag_links: linkRows.length,
      card_tags: cardTagRows.length,
      // The theme score's N (CLAUDE.md, Phase 3): read by oracle_tag_tree() so it needn't scan 700k rows.
      tagged_cards: new Set(cardTagRows.map((r) => r[0])).size,
      tagged_illustrations: new Set(illusTagRows.map((r) => r[0])).size,
      illustration_tags: illusTagRows.length,
      skipped,
      source_updated_at: { oracle_cards: entry("oracle_cards").updated_at, oracle_tags: entry("oracle_tags").updated_at, art_tags: entry("art_tags").updated_at },
      seconds: Math.round((Date.now() - t0) / 1000),
    };
    await client.query(
      "update public.import_runs set status = 'succeeded', finished_at = now(), counts = $2 where id = $1",
      [runId, JSON.stringify(counts)],
    );
    log("Done.");
    console.log(JSON.stringify(counts, null, 2));
  } catch (err) {
    await client.query("rollback").catch(() => {});
    await client
      .query("update public.import_runs set status = 'failed', finished_at = now(), error = $2 where id = $1", [
        runId,
        String(err instanceof Error ? err.message : err),
      ])
      .catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
