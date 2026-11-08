// Change log timeline: every card added, removed or recounted, newest first (deck_change_log, migration 0030).
// The database writes one row per card per board per edit; this groups them into edits and turns a removal from
// one board plus an addition to another in the same edit into a single "moved".
import { BOARDS, type Board } from "./model";

export type LogRow = {
  id: number;
  edit_id: number;
  changed_at: string;
  oracle_id: string;
  name: string;
  board: string;
  from_qty: number;
  to_qty: number;
};

export type TimelineItem =
  | {
      kind: "added" | "removed" | "count";
      oracle_id: string;
      name: string;
      board: Board;
      from: number;
      to: number;
    }
  | {
      kind: "moved";
      oracle_id: string;
      name: string;
      board: Board;
      fromBoard: Board;
      qty: number;
    };

export type TimelineEdit = {
  id: number;
  at: string;
  items: TimelineItem[];
  plus: number;
  minus: number;
};

const isBoard = (b: string): b is Board => (BOARDS as string[]).includes(b);

/** Rows in any order → edits, newest first; items keep the order they were saved in. */
export function readTimeline(rows: LogRow[]): TimelineEdit[] {
  const byEdit = new Map<number, LogRow[]>();
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    if (!isBoard(r.board) || r.from_qty === r.to_qty) continue;
    const list = byEdit.get(r.edit_id) ?? [];
    list.push(r);
    byEdit.set(r.edit_id, list);
  }

  const edits: TimelineEdit[] = [];
  for (const [id, list] of byEdit) {
    const items: TimelineItem[] = [];
    const used = new Set<LogRow>();
    for (const r of list) {
      if (used.has(r)) continue;
      used.add(r);
      // A card that leaves one board and arrives on another in the same edit was moved.
      if (r.to_qty === 0 || r.from_qty === 0) {
        const pair = list.find(
          (o) => !used.has(o) && o.oracle_id === r.oracle_id && o.board !== r.board && (r.to_qty === 0 ? o.from_qty === 0 : o.to_qty === 0),
        );
        if (pair) {
          used.add(pair);
          const [out, into] = r.to_qty === 0 ? [r, pair] : [pair, r];
          items.push({
            kind: "moved",
            oracle_id: r.oracle_id,
            name: r.name,
            board: into.board as Board,
            fromBoard: out.board as Board,
            qty: into.to_qty,
          });
          continue;
        }
      }
      const kind = r.from_qty === 0 ? "added" : r.to_qty === 0 ? "removed" : "count";
      items.push({
        kind,
        oracle_id: r.oracle_id,
        name: r.name,
        board: r.board as Board,
        from: r.from_qty,
        to: r.to_qty,
      });
    }
    let plus = 0;
    let minus = 0;
    for (const it of items) {
      if (it.kind === "moved") continue;
      if (it.to > it.from) plus += it.to - it.from;
      else minus += it.from - it.to;
    }
    edits.push({
      id,
      at: list[list.length - 1].changed_at,
      items,
      plus,
      minus,
    });
  }
  return edits.sort((a, b) => (a.at === b.at ? b.id - a.id : b.at.localeCompare(a.at)));
}

/** "just now", "5 min ago", "3 h ago", then the date ("Nov 2, 8:15 PM"). */
export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
