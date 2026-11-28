import { describe, expect, it } from "vitest";
import { pmapDelete, pmapEmpty, pmapEntries, pmapFrom, pmapGet, pmapSet } from "./pmap";
import { nextInt, seedRng } from "./rng";

describe("persistent map", () => {
  it("sets, gets and deletes without changing older versions", () => {
    const a = pmapEmpty<string>();
    const b = pmapSet(a, 1, "one");
    const c = pmapSet(b, 2, "two");
    const d = pmapDelete(c, 1);
    expect(pmapGet(a, 1)).toBeUndefined();
    expect(pmapGet(b, 1)).toBe("one");
    expect(pmapGet(c, 2)).toBe("two");
    expect(pmapGet(d, 1)).toBeUndefined();
    expect(pmapGet(d, 2)).toBe("two");
    expect([a.size, b.size, c.size, d.size]).toEqual([0, 1, 2, 1]);
  });

  it("grows past 32, 1,024 and 32,768 keys", () => {
    const keys = [0, 31, 32, 1023, 1024, 40000, 2_000_000];
    const m = pmapFrom(keys.map((k) => [k, k * 2] as [number, number]));
    for (const k of keys) expect(pmapGet(m, k)).toBe(k * 2);
    expect(pmapEntries(m).map(([k]) => k)).toEqual(keys);
  });

  it("shares untouched nodes (only the changed path is copied)", () => {
    const m = pmapFrom(Array.from({ length: 2000 }, (_, i) => [i, i] as [number, number]));
    const n = pmapSet(m, 5, -5);
    expect(n.root[1]).toBe(m.root[1]); // the branch holding keys 1024..2047 is the same object
    expect(n.root[0]).not.toBe(m.root[0]);
  });

  it("matches a plain Map over 20,000 random operations", () => {
    let rng = seedRng(7);
    let m = pmapEmpty<number>();
    const ref = new Map<number, number>();
    for (let i = 0; i < 20000; i++) {
      let k: number, op: number;
      [k, rng] = nextInt(rng, 3000);
      [op, rng] = nextInt(rng, 3);
      if (op === 0) {
        m = pmapDelete(m, k);
        ref.delete(k);
      } else {
        m = pmapSet(m, k, i);
        ref.set(k, i);
      }
    }
    expect(m.size).toBe(ref.size);
    expect(pmapEntries(m)).toEqual([...ref.entries()].sort((x, y) => x[0] - y[0]));
  });

  it("refuses bad keys and undefined values", () => {
    expect(() => pmapSet(pmapEmpty(), -1, 1)).toThrow();
    expect(() => pmapSet(pmapEmpty(), 1.5, 1)).toThrow();
    expect(() => pmapSet(pmapEmpty<number | undefined>(), 1, undefined)).toThrow();
  });
});
