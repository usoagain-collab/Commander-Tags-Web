// A deck row's chosen printing and foil state (migration 0025). Pure logic; fetching lives in lib/scryfall/printings.ts.
// Images need no storage: Scryfall's CDN path comes from the printing id. Set, art and prices are copied at pick time.

export type ChosenPrinting = {
  id: string;
  set: string;
  set_name: string;
  number: string;
  illustration_id: string | null;
  /** Scryfall finishes: nonfoil, foil, etched. */
  finishes: string[];
  usd: number | null;
  usd_foil: number | null;
  usd_etched: number | null;
  foil: boolean;
  /** Scryfall's image version stamp; changes when Scryfall replaces the picture (a preview scan, say). */
  image_v?: string | null;
  /** The illustrator, for the art credit beside an art crop. Missing on rows saved before migration 0051 until the nightly import fills it. */
  artist?: string | null;
};

/**
 * Scryfall CDN image for a printing id: /<size>/<side>/<1st char>/<2nd char>/<id>.jpg, plus Scryfall's version stamp
 * when known, so a browser fetches the new picture once Scryfall replaces it.
 */
export const printingImage = (id: string, size: "small" | "normal" | "art_crop" = "normal", side: "front" | "back" = "front", version?: string | null) =>
  `https://cards.scryfall.io/${size}/${side}/${id[0]}/${id[1]}/${id}.jpg${version ? `?${version}` : ""}`;

/** The printing a default card image shows, read from its URL. */
export const printingIdFromImage = (url: string | null) =>
  url?.match(/\/(?:front|back)\/[0-9a-f]\/[0-9a-f]\/([0-9a-f-]{36})\./)?.[1] ?? null;

const hasNonfoil = (finishes: string[]) => finishes.includes("nonfoil");
export const hasFoil = (finishes: string[]) => finishes.includes("foil") || finishes.includes("etched");

/** The foil state a printing can actually have: a foil-only printing is always foil, one with no foil never is. */
export function foilFor(finishes: string[], wanted: boolean) {
  if (!hasFoil(finishes)) return false;
  return hasNonfoil(finishes) ? wanted : true;
}

/** What this printing costs as chosen. Etched counts as foil. Null when Scryfall has no price for it. */
export function printingPrice(p: ChosenPrinting) {
  return p.foil ? (p.usd_foil ?? p.usd_etched) : p.usd;
}

/** Export marker for a foil card: Moxfield and Archidekt write *F*, or *E* for etched. */
export function foilMarker(p: ChosenPrinting) {
  if (!p.foil) return "";
  return p.finishes.includes("foil") ? " *F*" : " *E*";
}
