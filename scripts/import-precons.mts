// Nightly precon import (v2): every Commander precon from MTGJSON (MIT license) as a public deck owned by the
// Deck Genome Precons account (scripts/create-precon-account.mjs), so all deck features work on them.
//
// Run locally:  npm run import:precons            (new decks and those released in the last 90 days)
//               npm run import:precons -- --all   (every deck)
// In CI:        the daily GitHub Actions workflow runs it after the Scryfall import (decks point at cards).
//
// Each deck keeps its exact printings and foils; printing details and prices come from Scryfall once, and the
// Scryfall import reprices chosen printings every night. A deck is rewritten only when its list changed (hash).
// Cards our database doesn't have yet are left out and logged; the next run adds them.
import { createHash } from "node:crypto";
import pg from "pg";
import { isCollectorEdition, PRECON_TYPES, preconRows, type MtgjsonDeck, type MtgjsonDeckEntry, type PreconRow } from "../src/lib/deck/precons.ts";

const MTGJSON = "https://mtgjson.com/api/v5";
const USER_AGENT = "DeckGenome/0.1 (nightly precon import; https://deckgenome.com)";
const PRECON_EMAIL = "precons@commander-tags.test";
const RECENT_DAYS = 90;
const all = process.argv.includes("--all");

type Info = {
  set: string;
  set_name: string;
  number: string;
  illustration_id: string | null;
  finishes: string[];
  usd: number | null;
  usd_foil: number | null;
  usd_etched: number | null;
  image_v: string | null;
  artist: string | null;
};
type ScryfallCard = {
  id: string;
  set: string;
  set_name: string;
  collector_number: string;
  illustration_id?: string;
  artist?: string;
  card_faces?: { illustration_id?: string; artist?: string; image_uris?: Record<string, string> }[];
  image_uris?: Record<string, string>;
  finishes?: string[];
  prices?: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...(init?.headers ?? {}) } });
    if (res.ok) return (await res.json()) as T;
    if (attempt >= 5) throw new Error(`${url} returned ${res.status}`);
    // 429 = too many requests: wait as long as asked (or a few seconds), then try again.
    const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * attempt;
    await sleep(wait);
  }
}

/** Printing details for Scryfall ids, 75 per request. Scryfall allows only about 2 collection requests a second. */
async function printingInfo(ids: string[]) {
  const out = new Map<string, Info>();
  const unique = [...new Set(ids)];
  const num = (s: string | null | undefined) => (s ? Number(s) : null);
  for (let i = 0; i < unique.length; i += 75) {
    if (i) await sleep(550);
    const body = await getJson<{ data: ScryfallCard[] }>("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: unique.slice(i, i + 75).map((id) => ({ id })) }),
    });
    for (const c of body.data)
      out.set(c.id, {
        set: c.set,
        set_name: c.set_name,
        number: c.collector_number,
        illustration_id: c.illustration_id ?? c.card_faces?.[0]?.illustration_id ?? null,
        finishes: c.finishes ?? ["nonfoil"],
        usd: num(c.prices?.usd),
        usd_foil: num(c.prices?.usd_foil),
        usd_etched: num(c.prices?.usd_etched),
        image_v: (c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal)?.match(/\?(\d+)/)?.[1] ?? null,
        artist: c.artist ?? c.card_faces?.[0]?.artist ?? null,
      });
  }
  return out;
}

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) throw new Error("SUPABASE_DB_URL is not set (see .env.local.example)");
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
const run = await client.query<{ id: string }>("insert into public.import_runs (source) values ('precons') returning id");
const runId = run.rows[0].id;

try {
  const owner = (await client.query<{ id: string }>("select id from auth.users where email = $1", [PRECON_EMAIL])).rows[0]?.id;
  if (!owner) throw new Error(`No ${PRECON_EMAIL} account: run scripts/create-precon-account.mjs once`);

  const list = (await getJson<{ data: MtgjsonDeckEntry[] }>(`${MTGJSON}/DeckList.json`)).data.filter((d) => PRECON_TYPES.includes(d.type));
  const have = new Map(
    (await client.query<{ file: string; hash: string }>("select precon->>'file' as file, precon->>'hash' as hash from public.decks where precon is not null")).rows.map((r) => [r.file, r.hash]),
  );
  const cutoff = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString().slice(0, 10);
  const todo = list.filter((d) => all || !have.has(d.fileName) || !d.releaseDate || d.releaseDate >= cutoff);
  console.log(`${list.length} Commander precons listed; checking ${todo.length}.`);

  const known = new Set((await client.query<{ oracle_id: string }>("select oracle_id from public.cards")).rows.map((r) => r.oracle_id));
  const changed: { entry: MtgjsonDeckEntry; deck: MtgjsonDeck; rows: PreconRow[]; hash: string }[] = [];
  let missingCards = 0;
  for (const entry of todo) {
    await sleep(100);
    const deck = (await getJson<{ data: MtgjsonDeck }>(`${MTGJSON}/decks/${encodeURIComponent(entry.fileName)}.json`)).data;
    const { rows, missing } = preconRows(deck, (id) => known.has(id));
    if (missing.length) {
      missingCards += missing.length;
      console.log(`  ${entry.name}: ${missing.length} card(s) not in our data yet (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""})`);
    }
    if (!rows.some((r) => r.board === "commander")) {
      console.log(`  ${entry.name}: no commander in our data, skipped`);
      continue;
    }
    const hash = createHash("sha1").update(JSON.stringify([deck.name, rows])).digest("hex");
    if (have.get(entry.fileName) !== hash) changed.push({ entry, deck, rows, hash });
  }
  console.log(`${changed.length} deck(s) new or changed.`);

  const ids = changed.flatMap((c) => c.rows.flatMap((r) => [r.printing_id, ...r.split.map((p) => p.printing_id)])).filter((id): id is string => !!id);
  const infos = ids.length ? await printingInfo(ids) : new Map<string, Info>();
  const printing = (id: string | null, foil: boolean) => {
    const info = id ? infos.get(id) : undefined;
    return info ? { id, foil, ...info } : null;
  };

  if (changed.length) {
    // One transaction. Edit logging and the touch trigger are off: precon rows are not anyone editing a deck.
    await client.query("begin");
    await client.query("alter table public.deck_cards disable trigger deck_cards_touch");
    await client.query("alter table public.deck_cards disable trigger deck_cards_log");
    for (const { entry, deck, rows, hash } of changed) {
      const commander = rows.find((r) => r.board === "commander")!;
      const setName = (commander.printing_id && infos.get(commander.printing_id)?.set_name) || entry.code;
      const precon = {
        file: entry.fileName,
        code: entry.code,
        set_name: setName,
        release: entry.releaseDate,
        type: entry.type,
        source: deck.source ?? null,
        collector: isCollectorEdition(entry.name),
        hash,
      };
      const { rows: saved } = await client.query<{ id: string }>(
        `insert into public.decks (owner_id, name, visibility, target_bracket, precon, cover_oracle_id)
         values ($1, $2, 'public', 2, $3, $4)
         on conflict ((precon->>'file')) where precon is not null
         do update set name = excluded.name, precon = excluded.precon, cover_oracle_id = excluded.cover_oracle_id, visibility = 'public'
         returning id`,
        [owner, entry.name.slice(0, 120), precon, commander.oracle_id],
      );
      const deckId = saved[0].id;
      await client.query("delete from public.deck_cards where deck_id = $1", [deckId]);
      const values = rows.map((r) => {
        const own = printing(r.printing_id, r.foil);
        const split = r.split.flatMap((p) => {
          const pr = printing(p.printing_id, p.foil);
          return pr ? [{ printing: pr, quantity: p.quantity }] : [];
        });
        return {
          oracle_id: r.oracle_id,
          board: r.board,
          quantity: r.quantity,
          printing_id: own ? r.printing_id : null,
          foil: own ? r.foil : false,
          printing_info: own ? { set: own.set, set_name: own.set_name, number: own.number, illustration_id: own.illustration_id, finishes: own.finishes, usd: own.usd, usd_foil: own.usd_foil, usd_etched: own.usd_etched, image_v: own.image_v } : null,
          printing_split: split.length ? split : null,
        };
      });
      await client.query(
        `insert into public.deck_cards (deck_id, oracle_id, board, quantity, printing_id, foil, printing_info, printing_split)
         select $1, oracle_id, board, quantity, printing_id, foil, printing_info, printing_split
         from jsonb_to_recordset($2::jsonb) as x(oracle_id uuid, board text, quantity smallint, printing_id uuid, foil boolean, printing_info jsonb, printing_split jsonb)`,
        [deckId, JSON.stringify(values)],
      );
    }
    await client.query("alter table public.deck_cards enable trigger deck_cards_touch");
    await client.query("alter table public.deck_cards enable trigger deck_cards_log");
    await client.query("commit");
  }

  const counts = { listed: list.length, checked: todo.length, written: changed.length, missing_cards: missingCards };
  await client.query("update public.import_runs set status = 'succeeded', finished_at = now(), counts = $2 where id = $1", [runId, counts]);
  console.log("Done:", counts);
} catch (err) {
  await client.query("rollback").catch(() => {});
  await client.query("update public.import_runs set status = 'failed', finished_at = now(), error = $2 where id = $1", [runId, String(err)]);
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end();
}
