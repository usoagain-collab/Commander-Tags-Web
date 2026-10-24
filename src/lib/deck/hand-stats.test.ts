import { describe, expect, it } from "vitest";
import { handStats } from "./hand-stats";

describe("handStats", () => {
  it("matches the math for a typical 99: 37 lands, 10 ramp", () => {
    const s = handStats([
      { land: true, ramp: false, quantity: 37 },
      { land: false, ramp: true, quantity: 10 },
      { land: false, ramp: false, quantity: 52 },
    ]);
    expect(s.hands).toBe(1000);
    expect(s.landSpread.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    // Expected lands in 7 cards = 7 × 37/99 ≈ 2.62
    expect(s.averageLands).toBeGreaterThan(2.4);
    expect(s.averageLands).toBeLessThan(2.85);
    // P(at least one of 10 in 8 cards) ≈ 1 − C(89,8)/C(99,8) ≈ 0.58; on the draw (9 cards) ≈ 0.62
    expect(s.rampByTurn2.play).toBeGreaterThan(0.52);
    expect(s.rampByTurn2.play).toBeLessThan(0.64);
    expect(s.rampByTurn2.draw).toBeGreaterThanOrEqual(s.rampByTurn2.play);
    expect(s.rampCards).toBe(10);
  });

  it("is repeatable and handles tiny decks", () => {
    const deck = [
      { land: true, ramp: false, quantity: 40 },
      { land: false, ramp: true, quantity: 59 },
    ];
    expect(handStats(deck)).toEqual(handStats(deck));
    expect(handStats([{ land: true, ramp: false, quantity: 3 }]).hands).toBe(0);
  });
});
