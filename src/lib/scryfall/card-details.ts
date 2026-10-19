// Card details for the card sheet (Phase 3b), fetched live from Scryfall when a card is opened:
// rules text, power/toughness/loyalty, every face, legality in each format, and rulings.
// Live rather than stored, so the database stays small and details are always current (Phase 3 plan).

export type CardFace = {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  flavorText?: string;
  /** "1/5", "Loyalty 3", "Defense 4", or undefined. */
  stats?: string;
  image?: string;
};

export type Legality = "legal" | "not_legal" | "banned" | "restricted";
export type LegalityRow = { format: string; name: string; status: Legality };
export type Ruling = { date: string; text: string };

export type CardDetails = {
  layout: string;
  faces: CardFace[];
  /** True when faces have their own images (transforming / modal double-faced cards): show a Flip button. */
  flippable: boolean;
  legalities: LegalityRow[];
  rulings: Ruling[];
  scryfallUri?: string;
};

type ScryfallFace = {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  flavor_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  image_uris?: { normal?: string };
};
export type ScryfallCard = ScryfallFace & {
  layout: string;
  card_faces?: ScryfallFace[];
  legalities?: Record<string, string>;
  rulings_uri?: string;
  scryfall_uri?: string;
};

// Display names for Scryfall's format keys; Commander first, then roughly by popularity.
const FORMATS: [key: string, name: string][] = [
  ["commander", "Commander"],
  ["brawl", "Brawl"],
  ["standardbrawl", "Standard Brawl"],
  ["competitivebrawl", "Competitive Brawl"],
  ["oathbreaker", "Oathbreaker"],
  ["paupercommander", "Pauper Commander"],
  ["duel", "Duel Commander"],
  ["predh", "PreDH"],
  ["standard", "Standard"],
  ["pioneer", "Pioneer"],
  ["modern", "Modern"],
  ["legacy", "Legacy"],
  ["vintage", "Vintage"],
  ["pauper", "Pauper"],
  ["historic", "Historic"],
  ["timeless", "Timeless"],
  ["alchemy", "Alchemy"],
  ["gladiator", "Gladiator"],
  ["penny", "Penny Dreadful"],
  ["premodern", "Premodern"],
  ["oldschool", "Old School"],
  ["future", "Future Standard"],
];

function stats(f: ScryfallFace): string | undefined {
  if (f.power != null && f.toughness != null) return `${f.power}/${f.toughness}`;
  if (f.loyalty != null) return `Loyalty ${f.loyalty}`;
  if (f.defense != null) return `Defense ${f.defense}`;
  return undefined;
}

/** Scryfall's card object, normalized: always a list of faces, legality in display order. */
export function normalizeCard(card: ScryfallCard, rulings: Ruling[] = []): CardDetails {
  const rawFaces = card.card_faces?.length ? card.card_faces : [card];
  const faces = rawFaces.map((f) => ({
    name: f.name,
    manaCost: f.mana_cost ?? "",
    typeLine: f.type_line ?? "",
    oracleText: f.oracle_text ?? "",
    flavorText: f.flavor_text || undefined,
    stats: stats(f),
    image: f.image_uris?.normal ?? (rawFaces.length === 1 ? card.image_uris?.normal : undefined),
  }));

  const legal = card.legalities ?? {};
  const known = new Set(FORMATS.map(([k]) => k));
  const legalities: LegalityRow[] = FORMATS.filter(([k]) => k in legal).map(([format, name]) => ({
    format,
    name,
    status: legal[format] as Legality,
  }));
  // Formats Scryfall adds later still show, under their raw key.
  for (const [format, status] of Object.entries(legal)) {
    if (!known.has(format)) legalities.push({ format, name: format.toUpperCase(), status: status as Legality });
  }

  return {
    layout: card.layout,
    faces,
    flippable: faces.length > 1 && faces.every((f) => !!f.image),
    legalities,
    rulings,
    scryfallUri: card.scryfall_uri,
  };
}

// ---------- fetching (browser) ----------

const cache = new Map<string, Promise<CardDetails>>();

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Scryfall returned ${res.status}`);
  return (await res.json()) as T;
}

/** One search request for the card, one for its rulings. Remembered for the rest of the visit. */
export function fetchCardDetails(oracleId: string): Promise<CardDetails> {
  if (!cache.has(oracleId)) {
    const p = (async () => {
      const list = await getJson<{ data: ScryfallCard[] }>(
        `https://api.scryfall.com/cards/search?${new URLSearchParams({ q: `oracleid:${oracleId}`, unique: "cards" })}`,
      );
      const card = list.data[0];
      if (!card) throw new Error("Scryfall has no card with that id");
      const rulings = card.rulings_uri
        ? (await getJson<{ data: { published_at: string; comment: string }[] }>(card.rulings_uri)).data.map((r) => ({
            date: r.published_at,
            text: r.comment,
          }))
        : [];
      return normalizeCard(card, rulings);
    })();
    p.catch(() => cache.delete(oracleId)); // let a later open retry after a network hiccup
    cache.set(oracleId, p);
  }
  return cache.get(oracleId)!;
}
