import { describe, expect, it } from "vitest";
import { applyOrder, mergeOrder, moveKey, readOrder } from "./order";

describe("left column order", () => {
  const id = (s: string) => s;
  it("puts saved keys first in their order, the rest after in their own order", () => {
    expect(applyOrder(["a", "b", "c", "d"], id, ["c", "x", "a"])).toEqual(["c", "a", "b", "d"]);
    expect(applyOrder(["a", "b"], id, [])).toEqual(["a", "b"]);
  });
  it("moves a key down after the row it is over, and up before it", () => {
    expect(moveKey(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moveKey(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(moveKey(["a", "b"], "a", "zz")).toEqual(["a", "b"]);
  });
  it("keeps saved keys from other decks behind the visible ones", () => {
    expect(mergeOrder(["b", "a"], ["x", "a", "y"])).toEqual(["b", "a", "x", "y"]);
    expect(mergeOrder(["a", "b", "c"], [], 2)).toEqual(["a", "b"]);
  });
  it("reads only string lists", () => {
    expect(readOrder(["a", 3, "b"])).toEqual(["a", "b"]);
    expect(readOrder(null)).toEqual([]);
  });
});
