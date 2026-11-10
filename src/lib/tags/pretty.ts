// Tagger shorthand that new players can't read (stress test, Nov 2026). Whole labels first, then words.
const WHOLE: Record<string, string> = {
  artifactify: "Becomes an artifact",
  auraify: "Becomes an Aura",
  enchantmentify: "Becomes an enchantment",
  creatureify: "Becomes a creature",
  "burn you": "Damages you",
  "burn any": "Damage to any target",
};
const WORDS: [RegExp, string][] = [
  [/\bpp\b/g, "+1/+1"],
  [/\bmm\b/g, "-1/-1"],
  [/\bmv\b/g, "mana value"],
];

/** "tutor-land-any" -> "Tutor: land any": Scryfall's labels read like database names, so tags are shown this way. */
export function prettyTag(label: string) {
  let text = label.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  const whole = WHOLE[text.toLowerCase()];
  if (whole) return whole;
  for (const [re, to] of WORDS) text = text.replace(re, to);
  text = text
    .replace(/^type addition (.+)$/i, "Adds type: $1")
    .replace(/^burn (.+)$/i, "Damage to $1")
    // "mill self", "death trigger self": the card does it to itself.
    .replace(/ self$/i, " (itself)");
  const family = text.match(/^(typal|tutor)\s+(.+)$/i);
  if (family) return `${family[1].charAt(0).toUpperCase()}${family[1].slice(1)}: ${family[2]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ROLE_COLORS: Record<string, string> = {
  Lands: "#c9a26b",
  Ramp: "#5fbf7f",
  "Card advantage": "#5aa9e6",
  "Targeted removal": "#ef6a4f",
  "Board wipes": "#f0964a",
  Protection: "var(--role-protection)",
  Recursion: "#b08be0",
  Tutors: "#5b7cfa",
};

/** Each standard role has its own color, the same everywhere; custom roles use the accent. */
export const roleColor = (name: string) => ROLE_COLORS[name] ?? "#e8b54d";
