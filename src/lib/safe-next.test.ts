import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/decks/abc?x=1")).toBe("/decks/abc?x=1");
  });
  it("refuses other sites", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "evil", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/decks");
    }
  });
});
