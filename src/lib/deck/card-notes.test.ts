import { describe, expect, it } from "vitest";
import { cleanNote, NOTE_MAX, shortNote } from "./card-notes";

describe("cleanNote", () => {
  it("trims and folds line breaks and spaces", () => {
    expect(cleanNote("  swap for\n\nSol Ring   once bought ")).toBe("swap for Sol Ring once bought");
  });
  it("treats blank text as no note", () => {
    expect(cleanNote(" \n\t ")).toBe("");
  });
  it("keeps to the length limit", () => {
    expect(cleanNote("x".repeat(400))).toHaveLength(NOTE_MAX);
  });
});

describe("shortNote", () => {
  it("leaves short notes alone and cuts long ones with an ellipsis", () => {
    expect(shortNote("short")).toBe("short");
    expect(shortNote("a".repeat(80), 10)).toBe(`${"a".repeat(9)}…`);
  });
});
