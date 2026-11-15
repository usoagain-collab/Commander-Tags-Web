// Co-build (V3, migration 0064): a friend builds a deck with you. The owner makes an invite link; whoever opens it
// while signed in becomes a co-builder and edits the deck's cards like the owner does. Everything else about the
// deck stays the owner's. All reads and writes go through the co-build functions in the database; this file shapes
// what they return. The editor's hook is in use-cobuild.ts, so server pages can import this file.

export const COBUILDERS_MAX = 5;

export type Cobuilder = { user_id: string; name: string | null; avatar_url: string | null; me: boolean };
export type CobuildInfo = {
  isOwner: boolean;
  /** The invite code, owner only; null when there is no link. */
  code: string | null;
  owner: { name: string | null; avatar_url: string | null };
  builders: Cobuilder[];
};
export type CobuildDeck = { id: string; name: string; owner: string | null; updated_at: string | null };
export type CobuildInvite = { deck_id: string; deck_name: string; owner: string | null; builders: number; joined: boolean };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function readCobuild(raw: unknown): CobuildInfo | null {
  const x = obj(raw);
  if (!x) return null;
  const owner = obj(x.owner);
  const builders = (Array.isArray(x.builders) ? x.builders : []).flatMap((b): Cobuilder[] => {
    const y = obj(b);
    if (!y || typeof y.user_id !== "string") return [];
    return [{ user_id: y.user_id, name: str(y.name), avatar_url: str(y.avatar_url), me: y.me === true }];
  });
  return {
    isOwner: x.is_owner === true,
    code: str(x.code),
    owner: { name: str(owner?.name), avatar_url: str(owner?.avatar_url) },
    builders,
  };
}

export function readCobuildDecks(raw: unknown): CobuildDeck[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): CobuildDeck[] => {
    const x = obj(r);
    if (!x || typeof x.id !== "string" || typeof x.name !== "string") return [];
    return [{ id: x.id, name: x.name, owner: str(x.owner), updated_at: str(x.updated_at) }];
  });
}

export function readCobuildInvite(raw: unknown): CobuildInvite | null {
  const x = obj(raw);
  if (!x || typeof x.deck_id !== "string" || typeof x.deck_name !== "string") return null;
  return { deck_id: x.deck_id, deck_name: x.deck_name, owner: str(x.owner), builders: Number(x.builders) || 0, joined: x.joined === true };
}

/** The invite link for a code, on this site. */
export function cobuildLink(code: string, origin: string) {
  return `${origin.replace(/\/$/, "")}/decks/cobuild/${encodeURIComponent(code)}`;
}

/** A person's name as shown, with a stand-in when they haven't set one. */
export function builderName(name: string | null) {
  return name ?? "A Deck Genome player";
}

/** The database's own messages are meant for people; anything else gets the fallback. */
export function cobuildError(message: string | undefined, fallback: string) {
  if (!message) return fallback;
  return /^(Sign in|That invite link|This deck already has|You can co-build|Only the deck owner)/.test(message) ? message : fallback;
}
