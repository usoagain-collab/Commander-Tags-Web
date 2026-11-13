// Who may open the admin pages (David, Nov 13, 2026: an admin-only stats page).
// ADMIN_USER_IDS is a server-only env var on Vercel: Supabase user ids (Authentication -> Users -> User UID),
// separated by commas. Nobody is an admin when it's empty or missing, so a fresh deploy stays locked.
// User ids, not emails: an id never changes and can't be claimed by signing up with someone's address.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseAdminIds(raw: string | undefined | null): Set<string> {
  const ids = new Set<string>();
  for (const part of (raw ?? "").split(/[\s,]+/)) {
    const id = part.trim().toLowerCase();
    if (UUID.test(id)) ids.add(id);
  }
  return ids;
}

export function isAdmin(userId: string | null | undefined, raw: string | undefined | null = process.env.ADMIN_USER_IDS): boolean {
  if (typeof userId !== "string" || !userId) return false;
  return parseAdminIds(raw).has(userId.toLowerCase());
}
