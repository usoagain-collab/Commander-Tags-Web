// Card language (v2, migration 0042): which printing is the same card, set and collector number in another
// language. Answers come from localized_printings; printings nobody has asked about yet are looked up on Scryfall
// (a few per call, within its rate limits) and saved for everyone, including "no such printing".
// Signed-in users only; the write uses the server-only key.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/user";
import { CARD_LANGS, type Localized, type OtherLang } from "@/lib/deck/card-language";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_AGENT = "DeckGenome/0.1 (card language; https://deckgenome.com)";
/** Printings looked up on Scryfall per call: one collection request, then a search per 15. Keeps a call near 3 s. */
const LOOKUPS = 45;
const PER_SEARCH = 15;

type Print = { id: string; set: string; collector_number: string; image_uris?: { normal?: string }; card_faces?: { image_uris?: { normal?: string } }[] };
const version = (c: Print) => (c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal)?.match(/\?(\d+)/)?.[1] ?? null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const scryfall = (url: string, init?: RequestInit) => fetch(url, { ...init, headers: { Accept: "application/json", "User-Agent": USER_AGENT, ...(init?.headers ?? {}) } });

export async function POST(request: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Card language isn't set up on this server." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { lang?: string; ids?: unknown };
  const lang = body.lang as OtherLang;
  if (!lang || lang === ("en" as string) || !(lang in CARD_LANGS)) return NextResponse.json({ error: "Unknown language." }, { status: 400 });
  const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, 100); // ids go in the database request address; a few hundred is too long

  const admin = createAdminClient();
  const found: Record<string, Localized> = {};
  const { data: cached, error } = await admin.from("localized_printings").select("printing_id, localized_id, image_v").eq("lang", lang).in("printing_id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  for (const r of cached ?? []) found[r.printing_id] = r.localized_id ? { localized_id: r.localized_id, image_v: r.image_v } : null;

  const missing = ids.filter((id) => !(id in found));
  const batch = missing.slice(0, LOOKUPS);
  if (batch.length) {
    // Set and collector number of each English printing.
    const res = await scryfall("https://api.scryfall.com/cards/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batch.map((id) => ({ id })) }),
    });
    if (res.ok) {
      const prints = ((await res.json()) as { data: Print[] }).data;
      const key = (set: string, number: string) => `${set}|${number}`;
      const bySpot = new Map(prints.map((p) => [key(p.set, p.collector_number), p.id]));
      // Every printing asked about gets an answer; one Scryfall no longer knows has no translation either.
      const answers = new Map<string, Localized>(batch.map((id) => [id, null]));
      let complete = true;
      for (let i = 0; i < prints.length; i += PER_SEARCH) {
        await sleep(i ? 520 : 120); // Scryfall allows about 2 searches a second
        const q = `lang:${lang} (${prints
          .slice(i, i + PER_SEARCH)
          .map((p) => `(e:${p.set} cn:"${p.collector_number}")`)
          .join(" or ")})`;
        const s = await scryfall(`https://api.scryfall.com/cards/search?${new URLSearchParams({ q, unique: "prints", include_multilingual: "true" })}`);
        if (s.status === 404) continue; // none of these exist in that language
        if (!s.ok) {
          complete = false;
          break;
        }
        for (const c of ((await s.json()) as { data: Print[] }).data) {
          const english = bySpot.get(key(c.set, c.collector_number));
          if (english) answers.set(english, { localized_id: c.id, image_v: version(c) });
        }
      }
      // Only save when every search answered, so a Scryfall hiccup never records "none" by mistake.
      if (complete && answers.size) {
        const rows = [...answers].map(([printing_id, a]) => ({ printing_id, lang, localized_id: a?.localized_id ?? null, image_v: a?.image_v ?? null, checked_at: new Date().toISOString() }));
        await admin.from("localized_printings").upsert(rows);
        for (const [id, a] of answers) found[id] = a;
      }
    }
  }
  return NextResponse.json({ found, pending: ids.filter((id) => !(id in found)).length });
}
