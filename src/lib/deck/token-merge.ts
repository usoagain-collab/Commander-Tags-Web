// Plain helpers for deck tokens (no React), usable on the server (playtest page) and in the browser.

export type DeckToken = { token_id: string; name: string; type_line: string; made_by: string[] };

/**
 * Different cards often point at different printings of the same token (six Treasure printings in one deck).
 * Non-creature tokens with the same name and type line are the same thing, so they merge into one entry (the
 * one made by the most cards keeps its image). Creature tokens stay apart: two Goblins can differ in power,
 * toughness or abilities, which the name and type line don't show.
 */
export function mergeTokens(tokens: DeckToken[]): DeckToken[] {
  const out: DeckToken[] = [];
  const byKey = new Map<string, DeckToken>();
  for (const t of [...tokens].sort((a, b) => b.made_by.length - a.made_by.length)) {
    if (/\bCreature\b/.test(t.type_line)) {
      out.push(t);
      continue;
    }
    const key = `${t.name}|${t.type_line}`;
    const seen = byKey.get(key);
    if (seen) seen.made_by = [...new Set([...seen.made_by, ...t.made_by])];
    else {
      const copy = { ...t, made_by: [...t.made_by] };
      byKey.set(key, copy);
      out.push(copy);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
