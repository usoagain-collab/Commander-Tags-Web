import { describe, expect, it } from "vitest";
import { buildQuery, insertTag, rankTags, scryfallSearchUrl, tagTokenAt } from "./query";
import { appendSyntax, EMPTY_FILTERS, filterSyntax, quote, sortNote } from "./filters";

const bg = { identity: new Set(["B", "G"]), inIdentity: true, legalOnly: true };

describe("buildQuery", () => {
  it("adds the commander's colors and Commander legality", () => {
    expect(buildQuery("otag:ramp", bg)).toBe("(otag:ramp) id<=bg f:commander game:paper");
  });

  it("keeps the user's own identity or format filters", () => {
    expect(buildQuery("otag:ramp id<=g", bg)).toBe("(otag:ramp id<=g) f:commander game:paper");
    expect(buildQuery("t:creature f:brawl", bg)).toBe("(t:creature f:brawl) id<=bg game:paper");
  });

  it("wraps the user's query so a top-level 'or' can't escape the filters", () => {
    expect(buildQuery("t:elf or t:zombie", bg)).toBe("(t:elf or t:zombie) id<=bg f:commander game:paper");
  });

  it("uses colorless for a colorless commander, and skips identity without a commander", () => {
    expect(buildQuery("sol", { ...bg, identity: new Set() })).toBe("(sol) id<=c f:commander game:paper");
    expect(buildQuery("sol", { ...bg, identity: null })).toBe("(sol) f:commander game:paper");
  });

  it("can turn the automatic filters off", () => {
    expect(buildQuery("sol ring", { identity: new Set(["B"]), inIdentity: false, legalOnly: false })).toBe("sol ring");
  });

  it("adds banned and preview cards when asked, but still only paper", () => {
    expect(buildQuery("otag:ramp", { ...bg, withBanned: true })).toBe(
      "(otag:ramp) id<=bg (f:commander or banned:commander or (date>today -st:token -st:memorabilia)) game:paper",
    );
    expect(buildQuery("t:elf f:brawl", { ...bg, withBanned: true })).toBe("(t:elf f:brawl) id<=bg game:paper");
  });

  it("builds an encoded Scryfall URL ordered by EDHREC popularity", () => {
    expect(scryfallSearchUrl("otag:ramp id<=bg")).toBe(
      "https://api.scryfall.com/cards/search?q=otag%3Aramp+id%3C%3Dbg&order=edhrec&unique=cards",
    );
  });
});

describe("tag autocomplete", () => {
  it("finds an otag being typed at the cursor", () => {
    const text = "t:creature otag:ram";
    expect(tagTokenAt(text, text.length)).toEqual({ kind: "oracle", partial: "ram", start: 16, end: 19 });
  });

  it("knows art tags, negation, and Scryfall's other tag keywords", () => {
    expect(tagTokenAt("-art:fro", 8)?.kind).toBe("art");
    expect(tagTokenAt("function:sac", 12)).toMatchObject({ kind: "oracle", partial: "sac" });
    expect(tagTokenAt("(otag:dra)", 9)).toMatchObject({ partial: "dra" });
  });

  it("ignores other keywords and a cursor inside the keyword", () => {
    expect(tagTokenAt("c:wu", 4)).toBeNull();
    expect(tagTokenAt("otag:ramp", 2)).toBeNull();
  });

  it("knows types, keywords and sets (v2)", () => {
    expect(tagTokenAt("t:elf", 5)).toMatchObject({ kind: "type", partial: "elf" });
    expect(tagTokenAt("o:ward -kw:fly", 14)).toMatchObject({ kind: "keyword", partial: "fly" });
    expect(tagTokenAt("set:ds", 6)).toMatchObject({ kind: "set", partial: "ds" });
  });

  it("offers suggestions right after the colon", () => {
    expect(tagTokenAt("otag:", 5)).toMatchObject({ partial: "", start: 5 });
  });

  it("replaces the partial slug and leaves the cursor after it", () => {
    const text = "otag:ram t:creature";
    const token = tagTokenAt(text, 8)!;
    expect(insertTag(text, token, "ramp")).toEqual({ text: "otag:ramp t:creature", caret: 10 });
    const end = "t:creature otag:ra";
    expect(insertTag(end, tagTokenAt(end, end.length)!, "ramp")).toEqual({ text: "t:creature otag:ramp ", caret: 21 });
  });

  it("ranks prefix matches first, then bigger tags", () => {
    const tags = [
      { slug: "land-ramp", size: 490 },
      { slug: "ramp", size: 549 },
      { slug: "cramped", size: 3 },
      { slug: "ramp-matters", size: 20 },
    ];
    expect(rankTags(tags, "ramp").map((t) => t.slug)).toEqual(["ramp", "ramp-matters", "land-ramp", "cramped"]);
  });

  it("puts an exact match first even when it is small", () => {
    const tags = [
      { slug: "sacrifice-outlet-creature", size: 898 },
      { slug: "sacrifice-outlet", size: 12 },
    ];
    expect(rankTags(tags, "sacrifice-outlet")[0].slug).toBe("sacrifice-outlet");
  });
});

describe("search sort (v2)", () => {
  it("adds a direction only when one is chosen", () => {
    expect(scryfallSearchUrl("t:elf", "usd")).not.toContain("dir=");
    expect(scryfallSearchUrl("t:elf", "usd", "desc")).toContain("order=usd&unique=cards&dir=desc");
    expect(sortNote("edhrec", "desc")).toBe("least played first");
  });
});

describe("filterSyntax (v2)", () => {
  it("is empty for an empty form", () => {
    expect(filterSyntax(EMPTY_FILTERS)).toBe("");
  });

  it("writes each field as Scryfall syntax", () => {
    const q = filterSyntax({
      ...EMPTY_FILTERS,
      colors: ["W", "G"],
      types: ["Equipment", "Aura"],
      text: "ward",
      mvMax: 3,
      priceMax: 5,
      sinceYear: 2022,
      noReserved: true,
    });
    expect(q).toBe("c>=wg (t:equipment or t:aura) o:ward mv<=3 usd<=5 is:firstprint year>=2022 -is:reserved");
  });

  it("quotes phrases and handles colorless, exact mana value and instant speed", () => {
    expect(filterSyntax({ ...EMPTY_FILTERS, colors: ["C"], mvMin: 2, mvMax: 2, text: "~ deals", instantSpeed: true })).toBe(
      'c=c (t:instant or kw:flash) o:"~ deals" mv=2',
    );
    expect(quote('Time "Lord"')).toBe('"Time Lord"');
    expect(appendSyntax("  otag:ramp ", "mv<=2")).toBe("otag:ramp mv<=2");
  });
});
