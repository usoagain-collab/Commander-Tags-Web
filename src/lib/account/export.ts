// "Download my data" (David, Nov 9, 2026: a plain text file people can read, not JSON).
// Decks come out in the same "1 Sol Ring (SET) 123 *F*" lines every deck site imports, so the file doubles as a backup.

export type ExportCardRow = {
  quantity: number;
  name: string;
  set?: string | null;
  number?: string | null;
  foil?: boolean;
  etched?: boolean;
};
export type ExportDeck = {
  name: string;
  visibility: string;
  bracket: number | null;
  created: string;
  updated: string;
  boards: Partial<Record<"commander" | "companion" | "main" | "maybe", ExportCardRow[]>>;
};
export type ExportData = {
  name: string | null;
  email: string | null;
  joined: string | null;
  decks: ExportDeck[];
  myTags: { name: string; scope: string; cards: string[] }[];
  wishlist: (ExportCardRow & { note?: string | null })[];
  collection: ExportCardRow[];
};

const BOARD_TITLES = [
  ["commander", "Commander"],
  ["companion", "Companion"],
  ["main", "Deck"],
  ["maybe", "Maybeboard"],
] as const;

export function cardLine(r: ExportCardRow): string {
  const printing = r.set ? ` (${r.set.toUpperCase()})${r.number ? ` ${r.number}` : ""}` : "";
  const finish = r.etched ? " *E*" : r.foil ? " *F*" : "";
  return `${r.quantity} ${r.name}${printing}${finish}`;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "unknown");
const byName = <T extends { name: string }>(rows: T[]) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
const rule = (title: string) => `\n${"=".repeat(60)}\n${title}\n${"=".repeat(60)}\n`;

export function formatExport(d: ExportData, now = new Date()): string {
  const out: string[] = [];
  out.push("Deck Genome: your data");
  out.push(`Downloaded ${now.toISOString().slice(0, 10)}`);
  out.push(`Name: ${d.name ?? "(none)"}`);
  if (d.email) out.push(`Email: ${d.email}`);
  out.push(`Account created: ${day(d.joined)}`);
  out.push("");
  out.push(`${d.decks.length} decks, ${d.myTags.length} of your own tags, ${d.wishlist.length} wish list cards, ${d.collection.reduce((s, r) => s + r.quantity, 0)} cards in your collection.`);
  out.push("Each deck list below can be pasted into Import on Deck Genome, Moxfield or Archidekt.");

  out.push(rule(`DECKS (${d.decks.length})`));
  if (!d.decks.length) out.push("No decks.");
  for (const deck of byName(d.decks)) {
    out.push(`--- ${deck.name} ---`);
    out.push(`Sharing: ${deck.visibility} · Target bracket: ${deck.bracket ?? "none"} · Created ${day(deck.created)} · Last edited ${day(deck.updated)}`);
    for (const [key, title] of BOARD_TITLES) {
      const rows = deck.boards[key];
      if (!rows?.length) continue;
      out.push("", title, ...byName(rows).map(cardLine));
    }
    out.push("");
  }

  out.push(rule(`MY TAGS (${d.myTags.length})`));
  if (!d.myTags.length) out.push("No tags.");
  for (const t of byName(d.myTags)) out.push(`${t.name} (${t.scope}): ${t.cards.length ? [...t.cards].sort().join(", ") : "no cards"}`);

  out.push(rule(`WISH LIST (${d.wishlist.length})`));
  if (!d.wishlist.length) out.push("Empty.");
  for (const w of byName(d.wishlist)) out.push(cardLine(w) + (w.note ? ` (note: ${w.note})` : ""));

  out.push(rule("COLLECTION"));
  if (!d.collection.length) out.push("Empty.");
  for (const c of byName(d.collection)) out.push(cardLine(c));

  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
