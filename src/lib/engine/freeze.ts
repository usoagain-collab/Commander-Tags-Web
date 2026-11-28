// Deep-freezes a state so a stray mutation anywhere in the engine throws (used by the tests).
// Parts already deep-frozen by an earlier call are skipped, so freezing after every step only walks what's new.

const done = new WeakSet<object>();

export function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !done.has(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
    done.add(v);
  }
  return v;
}
