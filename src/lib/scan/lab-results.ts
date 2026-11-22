// Card scanner experiment (Nov 21, 2026): one row per test scan, the summary, and the text David copies back.
// Kept in this browser's local storage only; nothing goes to the database.

import type { FoilMark } from "./collector-line";

export const LAB_KEY = "scan-lab:results";

export interface LabResult {
  at: string; // ISO time
  source: "camera" | "still" | "photo" | "url"; // still = a full-resolution photo taken from the live camera
  // The truth David picked.
  trueName: string;
  truePrinting: string; // "set/number" of the printing David picked (language is separate)
  trueSet: string;
  trueNumber: string;
  trueLang: string;
  foil: boolean;
  sleeved: boolean;
  note: string;
  // Method 1: read the name.
  nameRead: string;
  nameMatch: string | null; // card name found from the read
  nameVia?: "scryfall" | "closest" | null; // Scryfall's fuzzy search, or the closest name in the full list
  // Method 2: read the collector line.
  lineRead: string;
  lineSet: string | null;
  lineNumber: string | null;
  lineLang: string | null;
  foilMark: FoilMark;
  linePrinting: string | null; // "set/number" of the printing Scryfall found for the line
  lineDisagrees?: boolean; // the line pointed at a different card than the name did (a misread)
  // Method 3: compare pictures with every printing of the card.
  candidates: number;
  cardRank: number | null; // where the true printing came, comparing the whole card (1 = best)
  artRank: number | null; // comparing the art box only
  ms: number; // time from capture to results
}

export function readLabResults(raw: string | null): LabResult[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((r) => r && typeof r === "object" && typeof r.truePrinting === "string") : [];
  } catch {
    return [];
  }
}

const sameName = (a: string | null, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

export interface LabSummary {
  scans: number;
  nameRight: number;
  lineReadable: number; // a set and a number came out of the line
  linePrintingRight: number;
  langRight: number; // of readable lines
  foilScans: number;
  foilMarkRight: number; // star on foils, dot on nonfoils, among lines with a mark read
  foilMarkRead: number;
  candidatesAvg: number;
  cardTop1: number;
  artTop1: number;
  printingRightAny: number; // the line's printing if read, else the best picture match
  avgMs: number;
}

export function summarize(rows: LabResult[]): LabSummary {
  const s: LabSummary = {
    scans: rows.length, nameRight: 0, lineReadable: 0, linePrintingRight: 0, langRight: 0, foilScans: 0,
    foilMarkRight: 0, foilMarkRead: 0, candidatesAvg: 0, cardTop1: 0, artTop1: 0, printingRightAny: 0, avgMs: 0,
  };
  for (const r of rows) {
    if (sameName(r.nameMatch, r.trueName)) s.nameRight++;
    const readable = !!(r.lineSet && r.lineNumber);
    if (readable) {
      s.lineReadable++;
      if (r.lineLang === r.trueLang) s.langRight++;
    }
    const lineRight = r.linePrinting === r.truePrinting;
    if (lineRight) s.linePrintingRight++;
    if (r.foil) s.foilScans++;
    if (r.foilMark) {
      s.foilMarkRead++;
      if ((r.foilMark === "star") === r.foil) s.foilMarkRight++;
    }
    if (r.cardRank === 1) s.cardTop1++;
    if (r.artRank === 1) s.artTop1++;
    // What a real scanner would do: trust the corner unless the name contradicts it, else the best picture match.
    if (r.linePrinting && !r.lineDisagrees ? lineRight : r.cardRank === 1) s.printingRightAny++;
    s.candidatesAvg += r.candidates;
    s.avgMs += r.ms;
  }
  if (rows.length) {
    s.candidatesAvg = Math.round((s.candidatesAvg / rows.length) * 10) / 10;
    s.avgMs = Math.round(s.avgMs / rows.length);
  }
  return s;
}

export const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

// Plain text David can paste back into the chat: the summary, then one tab-separated line per scan.
export function resultsText(rows: LabResult[]): string {
  const s = summarize(rows);
  const head = [
    `Scan lab results, ${rows.length} scans`,
    `Name read right: ${s.nameRight}/${s.scans} (${pct(s.nameRight, s.scans)})`,
    `Collector line readable: ${s.lineReadable}/${s.scans}; right printing from it: ${s.linePrintingRight}/${s.scans}; language right: ${s.langRight}/${s.lineReadable}`,
    `Foil mark read: ${s.foilMarkRead}, matching foil/nonfoil: ${s.foilMarkRight}; foil scans: ${s.foilScans}`,
    `Picture match top 1: whole card ${s.cardTop1}/${s.scans}, art only ${s.artTop1}/${s.scans} (avg ${s.candidatesAvg} printings to choose from)`,
    `Right printing (corner unless the name disagrees, else picture): ${s.printingRightAny}/${s.scans} (${pct(s.printingRightAny, s.scans)})`,
    `Average time: ${s.avgMs} ms`,
    "",
  ];
  const cols: (keyof LabResult)[] = [
    "at", "source", "trueName", "trueSet", "trueNumber", "trueLang", "foil", "sleeved", "nameRead", "nameMatch", "nameVia",
    "lineRead", "lineSet", "lineNumber", "lineLang", "foilMark", "linePrinting", "lineDisagrees", "truePrinting", "candidates", "cardRank", "artRank", "ms", "note",
  ];
  const clean = (v: unknown) => String(v ?? "").replace(/[\t\r\n]+/g, " ");
  return [...head, cols.join("\t"), ...rows.map((r) => cols.map((c) => clean(r[c])).join("\t"))].join("\n");
}
