// Gamer look (v2): the deck page takes its accent from the commander's colors. Two shades per color, tuned to
// read on the dark and the light look; black uses a violet so it shows on a near-black page.
export const MANA_ACCENT: Record<string, { dark: string; light: string }> = {
  W: { dark: "#f1e3b0", light: "#a07d1c" },
  U: { dark: "#4b9be0", light: "#1f5f9e" },
  B: { dark: "#a88ccc", light: "#5b3f80" },
  R: { dark: "#ec6a4c", light: "#b03a1f" },
  G: { dark: "#4fbf78", light: "#23784a" },
  C: { dark: "#b8b4aa", light: "#6a665d" },
};

const WUBRG = ["W", "U", "B", "R", "G"];

/**
 * CSS variables for a deck's colors, both looks at once (globals.css picks by data-theme through .deck-colors):
 * the first two colors in WUBRG order, the same color twice for mono, grey for colorless. Undefined (gold stays)
 * while the deck has no commander.
 */
export function deckAccentVars(identity: Set<string> | null): Record<string, string> | undefined {
  if (!identity) return undefined;
  const colors = WUBRG.filter((c) => identity.has(c));
  const [a, b] = colors.length ? [colors[0], colors[1] ?? colors[0]] : ["C", "C"];
  return { "--accent-d1": MANA_ACCENT[a].dark, "--accent-d2": MANA_ACCENT[b].dark, "--accent-l1": MANA_ACCENT[a].light, "--accent-l2": MANA_ACCENT[b].light };
}
