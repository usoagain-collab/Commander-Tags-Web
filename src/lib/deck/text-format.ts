// Deck lists as text: parse what people paste from Moxfield, Archidekt, MTGO, Arena or by hand,
// and export to each of those formats. Pure functions, no network: name lookup happens separately.
// Parsing starts from the prototype's parseDeck and extends it (companions, MTGO layout, SB: lines).

import { expandLines, type Splits } from "./splits";
import {
  BOARDS,
  entryKey,
  groupByType,
  linesFor,
  parseKey,
  qty,
  type Board,
  type CardSummary,
  type Change,
  type DeckLine,
  type Entries,
  type PrintingChange,
  type Printings,
  type RowChange,
} from "./model";
import { foilMarker, type ChosenPrinting } from "./printing";

// ---------- parsing ----------

export type ParsedLine = {
  lineNo: number;
  raw: string;
  name: string;
  quantity: number;
  /** null = no section said where it goes; decided after name lookup (see planImport). */
  board: Board | null;
  /** In a list with no headers, the last blank-line-separated group of 1–2 single cards: MTGO and plain
   *  exports put the commander there. Becomes the commander if every card in it can be one. */
  commanderCandidate: boolean;
  /** A printing named on the line: "(C21) 263", foil from *F* or *E*. */
  set?: string;
  number?: string;
  foil?: boolean;
};

export type IgnoredLine = { lineNo: number; raw: string; reason: string };
export type ParseResult = { lines: ParsedLine[]; ignored: IgnoredLine[] };

const HEADERS: [RegExp, Board | "skip"][] = [
  [/^(commanders?)$/, "commander"],
  [/^(companions?)$/, "companion"],
  [/^(deck|main|mainboard|main deck)$/, "main"],
  [/^(sideboard|maybeboard|maybe|considering)$/, "maybe"],
  [/^(tokens?|attractions?|stickers?|about)$/, "skip"],
];

export function parseDeckText(text: string): ParseResult {
  const lines: ParsedLine[] = [];
  const ignored: IgnoredLine[] = [];
  let section: Board | "skip" | null = null;
  let sawHeader = false;
  let group = 0;
  const groupOf: number[] = [];

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const lineNo = i + 1;
    let line = rawLine.trim();
    if (!line) {
      if (lines.length && groupOf[groupOf.length - 1] === group) group++;
      return;
    }

    const head = line.replace(/^\/\/\s*/, "").replace(/:$/, "").trim().toLowerCase();
    const header = HEADERS.find(([re]) => re.test(head));
    if (header) {
      section = header[1];
      sawHeader = true;
      return;
    }
    if (line.startsWith("//") || line.startsWith("#")) return; // comments
    if (section === "skip") return;
    if (/^name\s/i.test(line) && !/^\d/.test(line)) return; // Arena "About / Name My Deck"

    let board: Board | null = section;
    if (/^SB:\s*/i.test(line)) {
      // MTGO marks sideboard lines with "SB:"; in Commander that's usually the commander.
      line = line.replace(/^SB:\s*/i, "");
      board = board ?? "maybe";
    }
    // Archidekt categories and Moxfield markers: [Commander{top}], [Maybeboard{noDeck}], *CMDR*, *F* (foil)
    const tags = [...line.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1].toLowerCase());
    if (tags.some((t) => t.startsWith("commander")) || /\*CMDR\*/i.test(line)) board = "commander";
    else if (tags.some((t) => t.startsWith("companion"))) board = "companion";
    else if (tags.some((t) => t.startsWith("maybeboard") || t.startsWith("sideboard"))) board = "maybe";
    const foil = /\*[FE]\*/i.test(line);
    line = line
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\^[^^]*\^/g, "")
      .replace(/\*[A-Z]+\*/gi, "")
      .trim();

    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const quantity = m ? parseInt(m[1], 10) : 1;
    const printing = (m ? m[2] : line).match(/\s+\(([A-Za-z0-9]{2,8})\)\s+(\S+)\s*$/);
    let name = (m ? m[2] : line)
      .replace(/\s+\([A-Za-z0-9]{2,8}\)(\s+\S+)?\s*$/, "") // " (C21) 263", " (PLST) C21-263"
      // Face separators: "Fire///Ice", "Fire//Ice", and Moxfield's plain export "Walk-In Closet/Forgotten Cellar"
      // all become "Fire // Ice". No real card has a single slash in its name, so this is safe.
      .replace(/\s*\/{1,3}\s*/g, " // ")
      .trim();
    name = name.replace(/\s+/g, " ");

    if (!name || quantity < 1) {
      ignored.push({ lineNo, raw: rawLine, reason: "Couldn't read a card name" });
      return;
    }
    lines.push({
      lineNo,
      raw: rawLine,
      name,
      quantity,
      board,
      commanderCandidate: false,
      ...(printing ? { set: printing[1], number: printing[2], foil } : {}),
    });
    groupOf.push(group);
  });

  // No headers and no explicit commander: the last small group may be the commander (MTGO / plain exports).
  const groups = new Set(groupOf);
  if (!sawHeader && groups.size > 1 && !lines.some((l) => l.board === "commander")) {
    const last = Math.max(...groupOf);
    const tail = lines.filter((_, i) => groupOf[i] === last);
    if (tail.length <= 2 && tail.every((l) => l.quantity === 1 && (l.board === null || l.board === "maybe"))) {
      tail.forEach((l) => (l.commanderCandidate = true));
    }
  }
  return { lines, ignored };
}

// ---------- turning a parsed list into a deck change ----------

export type ImportReport = {
  counts: Record<Board, number>;
  notFound: ParsedLine[];
  trimmed: { name: string; wanted: number; kept: number; board: Board }[];
  /** Lines that added nothing because the card is already in the deck (each name once). */
  alreadyIn: string[];
  /** Cards outside the commanders' colors (each name once); they're still added, with the deck's usual warning. */
  offColor: string[];
  commanderFromLayout: boolean;
};

/**
 * Builds ONE change for the whole import (so a single undo reverts it), applying the same rules as
 * the editor: one commander/companion copy each, singleton across the deck, copy limits.
 */
export function planImport(
  current: Entries,
  parsed: ParsedLine[],
  found: Record<string, CardSummary>, // keyed by lowercased parsed name
  mode: "add" | "replace",
  /** Printings the list named, and the ones the deck has now. */
  chosen: {
    printingOf?: (line: ParsedLine, card: CardSummary) => ChosenPrinting | null;
    current?: Printings;
    /** Cards already in the deck, so a commander that stays is known even when the list doesn't name it. */
    cards?: Record<string, CardSummary>;
  } = {},
): { change: Change; report: ImportReport } {
  const target: Entries = mode === "replace" ? {} : { ...current };
  const report: ImportReport = {
    counts: { commander: 0, main: 0, companion: 0, maybe: 0 },
    notFound: [],
    trimmed: [],
    alreadyIn: [],
    offColor: [],
    commanderFromLayout: false,
  };

  const candidates = parsed.filter((l) => l.commanderCandidate);
  const candidatesAreCommanders =
    candidates.length > 0 && candidates.every((l) => found[l.name.toLowerCase()]?.can_be_commander);
  report.commanderFromLayout = candidatesAreCommanders;

  const named = new Map<string, ChosenPrinting>();
  const deckCopies = (id: string) => qty(target, "commander", id) + qty(target, "main", id) + qty(target, "companion", id);

  for (const line of parsed) {
    const card = found[line.name.toLowerCase()];
    if (!card) {
      report.notFound.push(line);
      continue;
    }
    let board: Board = line.board ?? "main";
    if (line.commanderCandidate) board = candidatesAreCommanders ? "commander" : (line.board ?? "main");

    const have = qty(target, board, card.oracle_id);
    let cap: number;
    if (board === "commander" || board === "companion") cap = 1;
    else if (board === "main") cap = card.max_copies - (deckCopies(card.oracle_id) - have);
    else cap = card.max_copies;
    const wanted = have + line.quantity;
    const kept = Math.max(have, Math.min(wanted, cap));
    // Nothing added and the card was already there (this board, or another one for singleton cards): not an error.
    const already = kept === have && (have > 0 || (board === "main" && deckCopies(card.oracle_id) > 0));
    if (already) {
      if (!report.alreadyIn.includes(card.name)) report.alreadyIn.push(card.name);
    } else if (kept < wanted) {
      const prev = report.trimmed.find((t) => t.name === card.name && t.board === board);
      if (prev) {
        prev.wanted += line.quantity;
        prev.kept += kept - have;
      } else report.trimmed.push({ name: card.name, wanted: line.quantity, kept: kept - have, board });
    }
    if (kept > 0) {
      target[entryKey(board, card.oracle_id)] = kept;
      const printing = chosen.printingOf?.(line, card);
      if (printing) named.set(entryKey(board, card.oracle_id), printing);
    }
  }

  const rows: RowChange[] = [];
  for (const k of new Set([...Object.keys(current), ...Object.keys(target)])) {
    const from = current[k] ?? 0;
    const to = target[k] ?? 0;
    if (from !== to) rows.push({ ...parseKey(k), from, to });
  }
  for (const [k, n] of Object.entries(target)) report.counts[parseKey(k).board] += n;

  // Cards outside the colors of the commanders the deck will have (current ones included).
  const byId = new Map<string, CardSummary>(Object.values(found).map((c) => [c.oracle_id, c]));
  const commanders = Object.keys(target).map(parseKey).filter((k) => k.board === "commander").map((k) => byId.get(k.oracle_id) ?? chosen.cards?.[k.oracle_id]);
  if (commanders.length && commanders.every(Boolean)) {
    const identity = new Set(commanders.flatMap((c) => c!.color_identity));
    for (const k of Object.keys(target).map(parseKey)) {
      if (k.board === "maybe" || k.board === "commander") continue;
      const c = byId.get(k.oracle_id);
      if (c && c.color_identity.some((x) => !identity.has(x)) && !report.offColor.includes(c.name)) report.offColor.push(c.name);
    }
  }

  const total = Object.values(report.counts).reduce((a, b) => a + b, 0);
  const printings: PrintingChange[] = [...named]
    .map(([k, to]) => ({ ...parseKey(k), from: chosen.current?.[k] ?? null, to }))
    .filter((p) => p.from?.id !== p.to.id || !!p.from?.foil !== p.to.foil);
  const label = `${mode === "replace" ? "Replace deck with" : "Import"} ${total} cards`;
  return { change: { label, rows, ...(printings.length ? { printings } : {}) }, report };
}

// ---------- exporting ----------

export const EXPORT_FORMATS = {
  moxfield: "Moxfield",
  archidekt: "Archidekt",
  mtgo: "MTGO",
  arena: "Arena",
  plain: "Plain text",
} as const;
export type ExportFormat = keyof typeof EXPORT_FORMATS;

export const EXPORT_NOTES: Record<ExportFormat, string> = {
  moxfield: "Paste into Moxfield's import box. Uses Commander / Deck / Maybeboard headings.",
  archidekt: "Paste into Archidekt's import. The commander is tagged [Commander{top}].",
  mtgo: "MTGO's format puts the commander after a blank line. The maybeboard isn't included.",
  arena: "Arena's format (Historic Brawl). The maybeboard isn't included.",
  plain: "One card per line with // headings. Readable anywhere, and re-imports here.",
};

const line = (l: DeckLine) => `${l.quantity} ${l.card.name}`;
/** " (C21) 263 *F*" for a card with a chosen printing. Arena and MTGO lists stay names only. */
const printed = (l: DeckLine) => (l.printing ? ` (${l.printing.set.toUpperCase()}) ${l.printing.number}${foilMarker(l.printing)}` : "");
const lineWithPrinting = (l: DeckLine) => line(l) + printed(l);

export function exportDeck(entries: Entries, cards: Record<string, CardSummary>, format: ExportFormat, printings: Printings = {}, splits: Splits = {}): string {
  const named = format === "moxfield" || format === "archidekt" || format === "plain";
  const by = (b: Board) => {
    // Mixed copies (v2): formats that name printings get one line per printing; Arena and MTGO stay one line.
    const plain = linesFor(entries, cards, b, printings);
    const lines = named ? expandLines(plain, splits, cards) : plain;
    // Mainboard in the editor's type order; other boards alphabetical.
    return b === "main" ? groupByType(lines).flatMap((g) => g.lines) : lines.sort((x, y) => x.card.name.localeCompare(y.card.name));
  };
  const commander = by("commander");
  const companion = by("companion");
  const main = by("main");
  const maybe = by("maybe");
  const block = (title: string | null, ls: DeckLine[], fmt = line) =>
    ls.length ? [...(title ? [title] : []), ...ls.map(fmt)].join("\n") : "";
  const join = (...blocks: string[]) => blocks.filter(Boolean).join("\n\n") + "\n";

  switch (format) {
    case "arena":
      return join(block("Commander", commander), block("Companion", companion), block("Deck", main));
    case "moxfield":
      return join(
        block("Commander", commander, lineWithPrinting),
        block("Companion", companion, lineWithPrinting),
        block("Deck", main, lineWithPrinting),
        block("Maybeboard", maybe, lineWithPrinting),
      );
    case "mtgo":
      return join(block(null, main), block(null, [...commander, ...companion]));
    case "archidekt": {
      const tagged = (tag: string) => (l: DeckLine) => `${l.quantity}x ${l.card.name}${printed(l)}${tag}`;
      return join(
        [
          block(null, commander, tagged(" [Commander{top}]")),
          block(null, companion, tagged(" [Companion{top}]")),
          block(null, main, tagged("")),
          block(null, maybe, tagged(" [Maybeboard{noDeck}{noPrice}]")),
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    case "plain":
      return join(
        ...BOARDS.map((b) => block(`// ${b === "main" ? "Mainboard" : b[0].toUpperCase() + b.slice(1)}`, by(b), lineWithPrinting)),
      );
  }
}
