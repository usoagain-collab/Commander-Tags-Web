// Smart Cutter: plain-language "why" for a suggested cut (docs/spec.md → Smart Cutter, section 4).
// Turns a CardScore into short sentences; the Cutter screen only lays them out.
import { prettyTag } from "@/lib/tags/pretty";
import { CURVE_LABELS } from "./archetype";
import { CUTTER } from "./config";
import type { Archetype } from "./archetypes";
import type { CardScore, Part } from "./score";

const ordinal = (n: number) => (n === 1 ? "" : `${n}${n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"} `);
const pct = (n: number) => `${Math.round(n)}%`;
const bucketName = (b: number) => (b === 0 ? "0-1 mana spells" : b === 6 ? "7+ mana spells" : `${CURVE_LABELS[b]}-drops`);

const popularityText = (rank: number | null) =>
  !rank
    ? "No EDHREC rank, so it counts as rarely played"
    : `EDHREC rank #${rank.toLocaleString("en-US")}: ${rank <= 300 ? "a staple, among the most played cards" : rank <= 3000 ? "widely played" : rank <= 10000 ? "played now and then" : "rarely played"}`;

/** One line for the shortlist and the cutting-room floor, also saved as the cut's reason in History. */
export function cutReason(s: CardScore): string {
  const over = s.facts.roles.filter((r) => r.count > r.target);
  const rank = [...s.facts.ranks].sort((a, b) => a.position / a.of - b.position / b.of)[0];
  const parts: string[] = [];
  if (over.length) parts.push(over.map((r) => `${r.name} ${r.count} / ${r.target}`).join(", "));
  if (rank) parts.push(`${ordinal(rank.position)}weakest of ${rank.of} in ${rank.name}`.trim());
  if (!s.facts.roles.length) parts.push(s.facts.themes.length ? "fills no role" : "fills no role and shares no top theme");
  if (!parts.length) parts.push("lowest keep score");
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type WhyLine = { label: string; text: string };

/** The "why" pop-up, section by section. */
export function explainCut(s: CardScore, archetype: Archetype, archetypeName = archetype.name): {
  hits: WhyLine[];
  rank: string;
  curve: string;
  flags: string[];
  parts: { part: Part; label: string; value: number; text: string }[];
} {
  const f = s.facts;
  const hits: WhyLine[] = [
    ...f.roles.map((r) => ({
      label: r.name,
      text: r.count > r.target ? `${r.count} / ${r.target}: ${r.count - r.target} over target` : r.count === r.target ? `${r.count} / ${r.target}: on target` : `${r.count} / ${r.target}: under target`,
    })),
    ...f.themes.map((t) => ({ label: prettyTag(t.label), text: `top theme, ${t.count} cards in the deck` })),
    // A spell // land card: scored as a spell, but it is also a land drop (David, Nov 7, 2026).
    ...(s.entry.card.counts_as_land ? [{ label: "Lands", text: "it's also a land, so cutting it lowers your Lands count too" }] : []),
  ];

  const ranked = f.ranks.map((r) => (r.position === 1 ? `The weakest of ${r.of} ${r.name} cards` : `${ordinal(r.position)}weakest of ${r.of} ${r.name} cards`));
  const rank = ranked.length
    ? `${ranked.join("; ")} (mana value, speed and how flexible it is)`
    : f.themeRank
      ? `${f.themeRank.position === 1 ? "The most expensive" : `${ordinal(f.themeRank.position)}most expensive`} of ${f.themeRank.of} cards sharing ${prettyTag(f.themeRank.theme.label)}`
      : f.roles.length
        ? "Too few cards in its roles to compare it with"
        : "No role to compare it in";

  const curve = s.flags.cheatTarget
    ? "Not counted on the curve: the deck can likely cheat it into play"
    : `${bucketName(f.bucket)} are ${pct(f.bucketShare)} of your spells; ${archetypeName} expects ${pct(f.expectedShare)}` +
      (f.bucket < CUTTER.curveFreeBuckets && f.bucketShare > f.expectedShare ? " (cheap cards never count against it)" : "");

  const flags = [
    ...s.flags.bracket.map((b) => `Above your bracket: ${b}`),
    ...(s.flags.strain ? [`Mana strain: ${s.flags.strain === "W" ? "white" : s.flags.strain === "U" ? "blue" : s.flags.strain === "B" ? "black" : s.flags.strain === "R" ? "red" : "green"} pips, few land sources for it`] : []),
  ];

  const p = s.parts;
  const themeText = !f.themes.length
    ? "Shares none of your top themes"
    : p.theme === 0
      ? "Its themes have no other cards in the deck, so they don't count"
      : `Shares ${f.themes.length} of your top themes`;
  const saturationText = !f.roles.length
    ? "Fills no role, so role targets don't affect it"
    : f.roles.every((r) => r.count > r.target)
      ? "Every role it fills is over target"
      : f.roles.some((r) => r.count > r.target)
        ? "Some of its roles are over target"
        : "None of its roles are over target";
  const parts = [
    { part: "coverage" as Part, label: "Role coverage", value: p.coverage, text: `Covers ${f.hits} of your roles and themes (the most any card covers is ${f.maxHits})` },
    { part: "saturation" as Part, label: "Saturation", value: p.saturation, text: saturationText },
    { part: "weakest" as Part, label: "Weakest in role", value: p.weakest, text: ranked.length ? ranked[0] : rank },
    { part: "theme" as Part, label: "Theme fit", value: p.theme, text: themeText },
    { part: "curve" as Part, label: "Curve fit", value: p.curve, text: s.flags.cheatTarget ? "Left off the curve" : curve },
    { part: "popularity" as Part, label: "Popularity", value: p.popularity, text: popularityText(s.entry.card.edhrec_rank) },
  ];
  return { hits, rank, curve, flags, parts };
}
