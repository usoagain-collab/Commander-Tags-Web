// Card language (v2): card images in your chosen language where Scryfall has that printing in it, else English.
// Names, rules text, search and tags stay English. Saved in profiles.tag_view.cardLang.
import type { CardSummary } from "./model";
import { printingIdFromImage, printingImage } from "./printing";

export const CARD_LANGS = { en: "English", ja: "日本語 (Japanese)", de: "Deutsch (German)", fr: "Français (French)", es: "Español (Spanish)", it: "Italiano (Italian)" } as const;
export type CardLang = keyof typeof CARD_LANGS;
export type OtherLang = Exclude<CardLang, "en">;

export const isCardLang = (v: unknown): v is CardLang => typeof v === "string" && v in CARD_LANGS;
export const readCardLang = (tagView: Record<string, unknown> | null | undefined): CardLang => (isCardLang(tagView?.cardLang) ? tagView.cardLang : "en");

/** A printing in another language: its Scryfall id and image version, or null when there is none. */
export type Localized = { localized_id: string; image_v: string | null } | null;

/** The card with its picture swapped for the localized printing, when one is known. Art crops stay (same art). */
export function localizeCard(card: CardSummary, lookup: (printingId: string) => Localized | undefined): CardSummary {
  const id = printingIdFromImage(card.image_normal);
  const hit = id ? lookup(id) : undefined;
  return hit ? { ...card, image_normal: printingImage(hit.localized_id, "normal", "front", hit.image_v) } : card;
}
