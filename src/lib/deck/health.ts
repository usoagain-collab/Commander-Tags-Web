// Deck health score (V3, Nov 15, 2026): one 0-100 number built from checks the Stats screen already shows, with
// each part's score so the chart can show where the points went. A rough guide, not a power rating: the bracket's
// "plays like" estimate stays separate.
import { COLOR_NAMES, type ColorRow } from "./stats";

export type HealthPart = { key: string; label: string; score: number; weight: number; detail: string };
export type Health = { score: number; parts: HealthPart[] };

export type HealthInput = {
  /** Shown roles other than Lands, with their counts. A target of 0 is left out. */
  roles: { name: string; target: number; count: number }[];
  lands: number;
  recommendedLands: number;
  /** Average mana value of the nonland cards. */
  average: number;
  colors: ColorRow[];
  /** Lands that always enter tapped; null while their text is loading. */
  tapped: number | null;
};

/** Weights add to 100. Roles weigh most: they are what the deck is built around. */
export const HEALTH_WEIGHTS = { roles: 35, lands: 25, curve: 15, colors: 15, tapped: 10 } as const;
/** Average mana value at or under this scores full marks; each point over it costs 40. */
export const CURVE_IDEAL = 3.2;
/** This many always-tapped lands are free; each one past it costs 10. */
export const TAPPED_FREE = 2;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function deckHealth(input: HealthInput): Health {
  const roles = input.roles.filter((r) => r.target > 0);
  const short = roles.filter((r) => r.count < r.target);
  const roleScore = roles.length ? (100 * roles.reduce((n, r) => n + Math.min(1, r.count / r.target), 0)) / roles.length : 100;

  const landGap = input.lands - input.recommendedLands;
  const shortColors = input.colors.filter((c) => c.pipShare - c.sourceShare > 0.1);
  const colorGap = input.colors.reduce((n, c) => n + Math.max(0, c.pipShare - c.sourceShare), 0);

  const parts: HealthPart[] = [
    {
      key: "roles",
      label: "Roles",
      score: clamp(roleScore),
      weight: HEALTH_WEIGHTS.roles,
      detail: !roles.length ? "No role targets set." : short.length ? `Under target: ${short.map((r) => r.name).join(", ")}.` : "Every role is on target.",
    },
    {
      key: "lands",
      label: "Land count",
      score: clamp(100 - 15 * Math.abs(landGap)),
      weight: HEALTH_WEIGHTS.lands,
      detail:
        landGap === 0
          ? `${input.lands} lands, as suggested.`
          : `${input.lands} lands; ${input.recommendedLands} suggested (${Math.abs(landGap)} ${landGap < 0 ? "short" : "over"}).`,
    },
    {
      key: "curve",
      label: "Curve",
      score: clamp(100 - 40 * Math.max(0, input.average - CURVE_IDEAL)),
      weight: HEALTH_WEIGHTS.curve,
      detail: `Average mana value ${input.average.toFixed(2)}${input.average > CURVE_IDEAL ? `, over ${CURVE_IDEAL}` : ""}.`,
    },
    {
      key: "colors",
      label: "Color sources",
      score: clamp(100 - 200 * colorGap),
      weight: HEALTH_WEIGHTS.colors,
      detail: shortColors.length ? `Few sources for ${shortColors.map((c) => COLOR_NAMES[c.color].toLowerCase()).join(", ")}.` : "Lands match your colors.",
    },
  ];
  if (input.tapped !== null) {
    parts.push({
      key: "tapped",
      label: "Tapped lands",
      score: clamp(100 - 10 * Math.max(0, input.tapped - TAPPED_FREE)),
      weight: HEALTH_WEIGHTS.tapped,
      detail: `${input.tapped} ${input.tapped === 1 ? "land always enters" : "lands always enter"} tapped.`,
    });
  }
  const weight = parts.reduce((n, p) => n + p.weight, 0);
  return { score: clamp(parts.reduce((n, p) => n + p.score * p.weight, 0) / weight), parts };
}
