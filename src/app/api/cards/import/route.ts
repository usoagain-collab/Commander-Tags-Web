// Spoiler fallback (Phase 7b, spec: Tag engine → Fallback): a card that's on Scryfall but not yet in our nightly
// data is fetched live by its Scryfall id and saved to the cards table, so it can be added to a deck right away.
// Its tags arrive with the next nightly import. Signed-in users only; the write uses the server-only key.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_AGENT = "CommanderTagsWeb/0.1 (spoiler fallback; github.com/usoagain-collab/Commander-Tags-Web)";

type Face = { image_uris?: Record<string, string>; illustration_id?: string; type_line?: string; oracle_text?: string; mana_cost?: string; oracle_id?: string };
type ScryfallCard = {
  oracle_id?: string; name: string; layout: string; mana_cost?: string; cmc?: number; type_line?: string; oracle_text?: string;
  color_identity?: string[]; legalities?: Record<string, string>; games?: string[]; edhrec_rank?: number;
  prices?: { usd?: string | null }; image_uris?: Record<string, string>; illustration_id?: string; card_faces?: Face[];
  game_changer?: boolean; produced_mana?: string[];
};

const IMAGE_SIZES = ["small", "normal", "large", "art_crop", "png"];
const joinFaces = (c: ScryfallCard, key: "type_line" | "oracle_text" | "mana_cost", sep: string) =>
  c[key] ?? ((c.card_faces ?? []).map((f) => f[key]).filter((s): s is string => s !== undefined).join(sep) || null);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  if (!id || !UUID.test(id)) return NextResponse.json({ error: "Not a Scryfall card id." }, { status: 400 });

  const res = await fetch(`https://api.scryfall.com/cards/${id}`, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (!res.ok) return NextResponse.json({ error: `Scryfall didn't find that card (HTTP ${res.status}).` }, { status: 404 });
  const c = (await res.json()) as ScryfallCard;
  // Reversible cards keep the oracle id on their faces.
  const oracleId = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
  if (!oracleId) return NextResponse.json({ error: "That card has no oracle id." }, { status: 422 });

  const front = c.card_faces?.[0];
  const uris = c.image_uris ?? front?.image_uris;
  const row = {
    oracle_id: oracleId,
    name: c.name,
    layout: c.layout,
    mana_cost: joinFaces(c, "mana_cost", " // "),
    mana_value: c.cmc ?? 0,
    type_line: joinFaces(c, "type_line", " // ") ?? "",
    oracle_text: joinFaces(c, "oracle_text", "\n//\n"),
    color_identity: c.color_identity ?? [],
    legalities: c.legalities ?? {},
    games: c.games ?? [],
    edhrec_rank: c.edhrec_rank ?? null,
    price_usd: c.prices?.usd ? Number(c.prices.usd) : null,
    image_uris: uris ? Object.fromEntries(IMAGE_SIZES.filter((k) => uris[k]).map((k) => [k, uris[k]])) : null,
    default_illustration_id: c.illustration_id ?? front?.illustration_id ?? null,
    game_changer: c.game_changer ?? false,
    produced_mana: c.produced_mana ?? [],
  };

  // The write needs the server-only key; without it (e.g. not set on this host yet) say so instead of crashing.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Fetching new cards isn't set up on this server yet. It will appear after the nightly update." }, { status: 503 });
  }
  const admin = createAdminClient();
  // Insert only if missing: never overwrite a card the nightly import already loaded.
  const { error } = await admin.from("cards").upsert(row, { onConflict: "oracle_id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: `Couldn't save the card: ${error.message}` }, { status: 500 });

  const { data: summary, error: readError } = await supabase.from("card_summaries").select("*").eq("oracle_id", oracleId).maybeSingle();
  if (readError || !summary) return NextResponse.json({ error: "Saved, but couldn't read it back." }, { status: 500 });
  return NextResponse.json({ card: summary });
}
