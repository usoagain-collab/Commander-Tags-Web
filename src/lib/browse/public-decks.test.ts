import { describe, expect, it } from "vitest";
import { browseHref, matchesColors, normalizeColors, parseBrowseQuery } from "./public-decks";

describe("browse query", () => {
  it("reads the address and drops what it doesn't understand", () => {
    expect(parseBrowseQuery({ q: "  Atraxa ", colors: "gbuw", bracket: "3", precons: "1", page: "2" })).toEqual({
      q: "Atraxa",
      colors: "WUBG",
      bracket: 3,
      precons: true,
      page: 2,
    });
    expect(parseBrowseQuery({ colors: "xyz", bracket: "9", page: "-1" })).toEqual({ q: "", colors: "", bracket: null, precons: false, page: 1 });
    expect(parseBrowseQuery({ colors: "c" }).colors).toBe("C");
    expect(parseBrowseQuery({ colors: ["U", "B"] }).colors).toBe("UB");
  });

  it("builds links that go back to page 1 when a filter changes", () => {
    const base = parseBrowseQuery({ q: "Krenko", colors: "R", page: "3" });
    expect(browseHref(base, { bracket: 2 })).toBe("/browse?q=Krenko&colors=R&bracket=2");
    expect(browseHref(base, { page: 4 })).toBe("/browse?q=Krenko&colors=R&page=4");
    expect(browseHref(parseBrowseQuery({}), {})).toBe("/browse");
  });
});

describe("colors", () => {
  it("normalizes to WUBRG order", () => {
    expect(normalizeColors("gUw")).toBe("WUG");
  });

  it("matches color identity exactly", () => {
    expect(matchesColors(["U", "W"], "WU")).toBe(true);
    expect(matchesColors(["W", "U", "B"], "WU")).toBe(false);
    expect(matchesColors([], "C")).toBe(true);
    expect(matchesColors(["R"], "C")).toBe(false);
    expect(matchesColors(["R"], "")).toBe(true);
  });
});
