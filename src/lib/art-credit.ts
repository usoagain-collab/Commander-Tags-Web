// Scryfall's image rules: wherever an art_crop shows, the artist name and the copyright line show in the same view,
// unless the full card image is there too (https://scryfall.com/docs/api/images).

export const COPYRIGHT_LINE = "™ & © Wizards of the Coast";

/** The artists, each named once, in the order given. Empty names are skipped. */
export function artistNames(artists: (string | null | undefined)[]): string[] {
  return [...new Set(artists.map((a) => a?.trim()).filter((a): a is string => !!a))];
}

/** "Art by Name, Name. ™ & © Wizards of the Coast", or null when no artist is known. */
export function artCreditText(artists: (string | null | undefined)[]): string | null {
  const names = artistNames(artists);
  return names.length ? `Art by ${names.join(", ")}. ${COPYRIGHT_LINE}` : null;
}

/** A Scryfall CDN image address at another size, e.g. a small full card in place of normal. */
export const atSize = (url: string, size: "small" | "normal" | "art_crop") => url.replace(/\/(small|normal|large|png|art_crop|border_crop)\//, `/${size}/`);
