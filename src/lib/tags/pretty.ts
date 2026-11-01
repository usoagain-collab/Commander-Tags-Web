/** "tutor-land-any" -> "Tutor land any": Scryfall's labels read like database names, so tags are shown this way. */
export function prettyTag(label: string) {
  const text = label.replace(/-/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ROLE_COLORS: Record<string, string> = {
  Lands: "#c9a26b",
  Ramp: "#5fbf7f",
  "Card advantage": "#5aa9e6",
  "Targeted removal": "#ef6a4f",
  "Board wipes": "#f0964a",
  Protection: "#e9e4d4",
  Recursion: "#b08be0",
};

/** Each standard role has its own color, the same everywhere; custom roles use the accent. */
export const roleColor = (name: string) => ROLE_COLORS[name] ?? "#e8b54d";
