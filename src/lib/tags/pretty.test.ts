import { describe, expect, it } from "vitest";
import { prettyTag } from "./pretty";

describe("prettyTag", () => {
  it("turns database-style labels into words", () => {
    expect(prettyTag("land-conversion")).toBe("Land conversion");
    expect(prettyTag("tutor-land-any")).toBe("Tutor: land any");
    expect(prettyTag("typal-merfolk")).toBe("Typal: merfolk");
    expect(prettyTag("Titan trigger")).toBe("Titan trigger");
  });
});
