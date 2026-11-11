import { artCreditText } from "@/lib/art-credit";

/** The art credit line Scryfall asks for beside an art crop, or nothing when no artist is known. */
export function ArtCredit({ artists, className = "", inline = false }: { artists: (string | null | undefined)[]; className?: string; inline?: boolean }) {
  const text = artCreditText(artists);
  if (!text) return null;
  // Inside a link or a span, a <p> isn't allowed, so the inline form is a block-level <span>.
  return inline ? <span className={`block text-xs opacity-70 ${className}`}>{text}</span> : <p className={`text-xs opacity-70 ${className}`}>{text}</p>;
}
