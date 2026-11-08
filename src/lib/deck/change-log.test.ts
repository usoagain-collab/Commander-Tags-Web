import { describe, expect, it } from "vitest";
import { readTimeline, timeAgo, type LogRow } from "./change-log";

let n = 0;
const row = (edit: number, at: string, name: string, board: string, from: number, to: number): LogRow => ({
  id: ++n,
  edit_id: edit,
  changed_at: at,
  oracle_id: name.toLowerCase(),
  name,
  board,
  from_qty: from,
  to_qty: to,
});

describe("readTimeline", () => {
  it("groups rows by edit, newest first", () => {
    const t = readTimeline([
      row(1, "2026-11-07T10:00:00Z", "Sol Ring", "main", 0, 1),
      row(2, "2026-11-07T10:05:00Z", "Forest", "main", 30, 28),
      row(2, "2026-11-07T10:05:00Z", "Island", "main", 0, 2),
    ]);
    expect(t.map((e) => e.id)).toEqual([2, 1]);
    expect(t[0].items.map((i) => i.kind)).toEqual(["count", "added"]);
    expect([t[0].plus, t[0].minus]).toEqual([2, 2]);
    expect(t[1].items[0]).toMatchObject({
      kind: "added",
      name: "Sol Ring",
      board: "main",
      from: 0,
      to: 1,
    });
  });

  it("joins a removal and an addition of the same card in one edit into a move", () => {
    const t = readTimeline([
      row(5, "2026-11-07T11:00:00Z", "Lightning Bolt", "main", 1, 0),
      row(5, "2026-11-07T11:00:00Z", "Lightning Bolt", "maybe", 0, 1),
    ]);
    expect(t[0].items).toEqual([
      {
        kind: "moved",
        oracle_id: "lightning bolt",
        name: "Lightning Bolt",
        board: "maybe",
        fromBoard: "main",
        qty: 1,
      },
    ]);
    expect([t[0].plus, t[0].minus]).toEqual([0, 0]);
  });

  it("keeps the same card in two separate edits apart", () => {
    const t = readTimeline([
      row(7, "2026-11-07T12:00:00Z", "Ponder", "main", 1, 0),
      row(8, "2026-11-07T12:01:00Z", "Ponder", "maybe", 0, 1),
    ]);
    expect(t.map((e) => e.items[0].kind)).toEqual(["added", "removed"]);
  });

  it("skips unknown boards and rows with no change", () => {
    expect(
      readTimeline([row(9, "2026-11-07T12:00:00Z", "X", "sideboard", 0, 1), row(9, "2026-11-07T12:00:00Z", "Y", "main", 1, 1)]),
    ).toEqual([]);
  });
});

describe("Smart Cutter notes (migration 0034)", () => {
  it("carries the edit label and each card's reason, also through a move", () => {
    const t = readTimeline([
      { ...row(7, "2026-11-07T11:00:00Z", "Cultivate", "main", 1, 0), label: "Smart Cutter", note: "Ramp 12 / 10" },
      { ...row(7, "2026-11-07T11:00:00Z", "Cultivate", "maybe", 0, 1), label: "Smart Cutter", note: "Ramp 12 / 10" },
      { ...row(7, "2026-11-07T11:00:00Z", "Opt", "main", 1, 0), label: "Smart Cutter", note: null },
    ]);
    expect(t[0].label).toBe("Smart Cutter");
    expect(t[0].items[0]).toMatchObject({ kind: "moved", name: "Cultivate", note: "Ramp 12 / 10" });
    expect(t[0].items[1]).toMatchObject({ kind: "removed", name: "Opt" });
    expect(t[0].items[1]).not.toHaveProperty("note");
  });

  it("leaves ordinary edits without a label", () => {
    expect(readTimeline([row(8, "2026-11-07T12:00:00Z", "Opt", "main", 0, 1)])[0]).not.toHaveProperty("label");
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  it("reads recent times in words", () => {
    expect(timeAgo("2026-11-07T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-11-07T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-11-07T09:00:00Z", now)).toBe("3 h ago");
  });
});
