// Spin the wheel (v2): five random Commander-legal commanders to choose from when starting a deck.
// Picking a random EDHREC rank and taking the first commander at or after it is one fast index walk (about 0.1 s),
// so no new database function is needed. Each pick also shows its tags and the starter archetypes they point to.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardSummary } from "@/lib/deck/model";
import { ARCHETYPES, GENERAL_KEY, type Archetype } from "@/lib/cutter/archetypes";
import { oKey, themeOk } from "@/lib/tags/themes";
import type { TagTree } from "@/lib/tags/tree";

/** EDHREC ranks run to about 33,000 (Nov 2026); a rank past the last commander just rolls again. */
export const MAX_RANK = 33000;
export const SPIN_COUNT = 5;

/** A front face that can lead: legendary (flip cards whose back face is legendary don't count). */
export const leadsFromFront = (c: Pick<CardSummary, "type_line">) => /\bLegendary\b/.test(c.type_line.split(" // ")[0]);

export async function spinCommanders(
  supabase: SupabaseClient,
  opts: { count?: number; exclude?: Set<string>; random?: () => number } = {},
): Promise<CardSummary[]> {
  const count = opts.count ?? SPIN_COUNT;
  const random = opts.random ?? Math.random;
  const seen = new Set(opts.exclude);
  const out: CardSummary[] = [];
  for (let round = 0; round < 4 && out.length < count; round++) {
    const ranks = Array.from({ length: (count - out.length) * 2 }, () => 1 + Math.floor(random() * MAX_RANK));
    const found = await Promise.all(
      ranks.map(async (rank) => {
        const { data, error } = await supabase
          .from("card_summaries")
          .select("*")
          .eq("can_be_commander", true)
          .eq("commander_legal", true)
          .not("type_line", "ilike", "%Background%")
          .gte("edhrec_rank", rank)
          .order("edhrec_rank")
          .limit(1);
        if (error) throw new Error(error.message);
        return (data?.[0] as CardSummary | undefined) ?? null;
      }),
    );
    for (const c of found) {
      if (!c || seen.has(c.oracle_id) || !leadsFromFront(c) || out.length >= count) continue;
      seen.add(c.oracle_id);
      out.push(c);
    }
  }
  return out;
}

/** Wording and rules-history tags that say nothing about how a commander plays (seen in the first spins). */
const SPIN_NOISE = /vanilla|roman numeral|deprecated|synergy blocker/;

/** The commander's gameplay tags worth showing, deepest (most specific) first. */
export function shownTags(slugs: string[], tree: TagTree, limit = 6): string[] {
  const ok = slugs.filter((s) => themeOk(oKey(s), "gameplay", { oracle: tree, art: null }, new Set()) && !SPIN_NOISE.test(tree.label(s) ?? s));
  return tree.sortDeepestFirst(ok).slice(0, limit);
}

/**
 * Starter archetypes the commander's own tags point to, strongest first: each archetype scores the weight of its
 * tag signals that one of the tags falls under. It's a reading of the card, not of what players build.
 */
export function archetypesFor(slugs: string[], tree: TagTree, list: Archetype[] = ARCHETYPES, limit = 3): string[] {
  const own = new Set(slugs);
  return list
    .filter((a) => a.key !== GENERAL_KEY)
    .map((a) => ({
      a,
      score: a.signals.reduce((s, sig) => (sig.kind === "tags" && [...tree.descendants(sig.slugs)].some((t) => own.has(t)) ? s + sig.weight : s), 0),
    }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.a.name.localeCompare(y.a.name))
    .slice(0, limit)
    .map((x) => x.a.name);
}
