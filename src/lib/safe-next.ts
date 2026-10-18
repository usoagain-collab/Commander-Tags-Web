// Only allow redirects back to our own pages (blocks "?next=https://evil.example").
export function safeNext(next: string | null | undefined, fallback = "/decks") {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
