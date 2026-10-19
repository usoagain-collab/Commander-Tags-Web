import { describe, expect, it } from "vitest";
import { nameProblem, nextColor, readMyTags, tagsOfCard, type MyTag } from "./my-tags";

const tag = (id: string, name: string, extra: Partial<MyTag> = {}): MyTag => ({ id, name, color: "slate", deck_id: null, ...extra });

describe("readMyTags", () => {
  it("sorts tags by name, fixes unknown colors and drops uses of unknown tags", () => {
    const r = readMyTags({
      tags: [
        { id: "b", name: "staple", color: "amber", deck_id: null },
        { id: "a", name: "Combo", color: "neon", deck_id: "d1" },
      ],
      cards: { sol: ["b", "zzz"], gone: ["zzz"] },
    });
    expect(r.tags.map((t) => [t.name, t.color])).toEqual([["Combo", "slate"], ["staple", "amber"]]);
    expect(r.cards).toEqual({ sol: ["b"] });
  });

  it("copes with an empty or broken value", () => {
    expect(readMyTags(null)).toEqual({ tags: [], cards: {} });
  });
});

describe("nameProblem", () => {
  const tags = [tag("1", "Win con"), tag("2", "Combo", { deck_id: "d" })];
  it("needs a name of 1-40 characters", () => {
    expect(nameProblem("  ", tags)).toMatch(/name/);
    expect(nameProblem("x".repeat(41), tags)).toMatch(/40/);
  });
  it("blocks duplicates in any scope, ignoring case, but not the tag's own name", () => {
    expect(nameProblem("win CON", tags)).toMatch(/Win con/);
    expect(nameProblem("combo", tags)).toMatch(/Combo/);
    expect(nameProblem("Combo", tags, "2")).toBeNull();
    expect(nameProblem("Staple", tags)).toBeNull();
  });
});

describe("colors and card tags", () => {
  it("picks an unused color, slate last", () => {
    expect(nextColor([])).toBe("red");
    expect(nextColor([tag("1", "a", { color: "red" })])).toBe("orange");
  });
  it("lists a card's tags in tag order", () => {
    const tags = [tag("1", "A"), tag("2", "B"), tag("3", "C")];
    expect(tagsOfCard({ sol: ["3", "1"] }, "sol", tags).map((t) => t.name)).toEqual(["A", "C"]);
  });
});
