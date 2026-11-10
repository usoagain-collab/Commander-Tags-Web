// Only allow redirects back to our own pages (blocks "?next=https://evil.example").
// Browsers read "/\evil.example" like "//evil.example", and drop tabs and newlines, so those are refused too.
export function safeNext(next: string | null | undefined, fallback = "/decks") {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (/[\\\t\r\n]/.test(next)) return fallback;
  return next;
}
