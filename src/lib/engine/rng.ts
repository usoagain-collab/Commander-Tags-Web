// Seeded random numbers (mulberry32). The whole generator state is one 32-bit number kept in the game
// state, so the same seed and the same actions always give the same game, on every platform.
// The state never leaves the referee during a game (engine-design.md section 6).

export type RngState = number;

export function seedRng(seed: number | string): RngState {
  if (typeof seed === "number") return seed >>> 0;
  // FNV-1a over the string, so "game-42" is a valid seed too.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One step: a float in [0, 1) and the next state. */
export function nextFloat(rng: RngState): [number, RngState] {
  const next = (rng + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** An integer in [0, n). */
export function nextInt(rng: RngState, n: number): [number, RngState] {
  const [f, next] = nextFloat(rng);
  return [Math.floor(f * n), next];
}

/** Fisher-Yates on a copy; the input is not changed. */
export function shuffled<T>(items: readonly T[], rng: RngState): [T[], RngState] {
  const out = items.slice();
  let r = rng;
  for (let i = out.length - 1; i > 0; i--) {
    let j: number;
    [j, r] = nextInt(r, i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return [out, r];
}
