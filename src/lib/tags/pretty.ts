/** "tutor-land-any" -> "Tutor land any": Scryfall's labels read like database names, so tags are shown this way. */
export function prettyTag(label: string) {
  const text = label.replace(/-/g, " ").trim();
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
