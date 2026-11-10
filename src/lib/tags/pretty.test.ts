import { describe, expect, it } from "vitest";
import { prettyTag } from "./pretty";

describe("prettyTag", () => {
  it("turns database-style labels into words", () => {
    expect(prettyTag("land-conversion")).toBe("Land conversion");
    expect(prettyTag("tutor-land-any")).toBe("Tutor: land any");
    expect(prettyTag("typal-merfolk")).toBe("Typal: merfolk");
    expect(prettyTag("Titan trigger")).toBe("Titan trigger");
  });
  it("spells out Tagger shorthand", () => {
    expect(prettyTag("gives pp counters")).toBe("Gives +1/+1 counters");
    expect(prettyTag("gains mm counters")).toBe("Gains -1/-1 counters");
    expect(prettyTag("cheaper than mv")).toBe("Cheaper than mana value");
    expect(prettyTag("type addition phyrexian")).toBe("Adds type: phyrexian");
    expect(prettyTag("burn creature")).toBe("Damage to creature");
    expect(prettyTag("burn-you")).toBe("Damages you");
    expect(prettyTag("artifactify")).toBe("Becomes an artifact");
    expect(prettyTag("mill-self")).toBe("Mill (itself)");
  });
});
