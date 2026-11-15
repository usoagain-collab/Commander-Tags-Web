import { describe, expect, it } from "vitest";
import { findTarget, shouldShowTour, TOUR_STEPS } from "./steps";

const el = (w: number) => ({ getBoundingClientRect: () => ({ width: w, height: w }) }) as unknown as Element;

describe("welcome tour", () => {
  it("shows on a builder's own deck until seen", () => {
    expect(shouldShowTour({}, false)).toBe(true);
    expect(shouldShowTour({ tourSeen: true }, false)).toBe(false);
    expect(shouldShowTour({}, true)).toBe(false);
  });

  it("points at the first target that is on screen", () => {
    const hidden = el(0);
    const shown = el(10);
    expect(findTarget({ querySelectorAll: () => [hidden, shown] as unknown as NodeListOf<Element> }, "roles")).toBe(shown);
    expect(findTarget({ querySelectorAll: () => [hidden] as unknown as NodeListOf<Element> }, "roles")).toBeNull();
  });

  it("has the four steps in order", () => {
    expect(TOUR_STEPS.map((s) => s.target)).toEqual(["roles", "suggest", "bracket", "playtest"]);
  });
});
