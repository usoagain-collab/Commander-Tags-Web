// A persistent (copy-on-write) map from small non-negative integers to values.
// engine-design.md section 1: a change copies only the path to the changed entry (about 3 small nodes),
// everything else is shared with the old map. Keys are object ids, which count up from 1.
//
// Shape: a 32-way trie. `shift` is how many bits the root's index uses; depth grows when a key outgrows it.

const BITS = 5;
const WIDTH = 1 << BITS; // 32
const MASK = WIDTH - 1;

type Node<V> = ReadonlyArray<Node<V> | V | undefined>;

export type PMap<V> = {
  readonly root: Node<V>;
  readonly shift: number; // bits below the root level; 0 = the root holds values
  readonly size: number;
};

const EMPTY_NODE: Node<never> = Object.freeze([]);

export function pmapEmpty<V>(): PMap<V> {
  return Object.freeze({ root: EMPTY_NODE as Node<V>, shift: 0, size: 0 });
}

function capacity(shift: number): number {
  return 2 ** (shift + BITS);
}

function checkKey(key: number): void {
  if (!Number.isInteger(key) || key < 0) throw new Error(`pmap: key must be a non-negative integer, got ${key}`);
}

export function pmapGet<V>(map: PMap<V>, key: number): V | undefined {
  if (key < 0 || key >= capacity(map.shift)) return undefined;
  let node: Node<V> | undefined = map.root;
  for (let shift = map.shift; shift > 0; shift -= BITS) {
    node = node[Math.floor(key / 2 ** shift) & MASK] as Node<V> | undefined;
    if (!node) return undefined;
  }
  return node[key & MASK] as V | undefined;
}

export function pmapHas<V>(map: PMap<V>, key: number): boolean {
  return pmapGet(map, key) !== undefined;
}

function withSlot<T>(node: ReadonlyArray<T | undefined>, index: number, value: T | undefined): ReadonlyArray<T | undefined> {
  const copy = node.slice();
  copy[index] = value;
  // Trim trailing holes so equal maps have equal shapes.
  while (copy.length > 0 && copy[copy.length - 1] === undefined) copy.pop();
  return Object.freeze(copy);
}

function setIn<V>(node: Node<V>, shift: number, key: number, value: V | undefined): Node<V> {
  if (shift === 0) return withSlot(node as ReadonlyArray<V | undefined>, key & MASK, value) as Node<V>;
  const index = Math.floor(key / 2 ** shift) & MASK;
  const child = (node[index] as Node<V> | undefined) ?? (EMPTY_NODE as Node<V>);
  const next = setIn(child, shift - BITS, key, value);
  return withSlot(node, index, next.length === 0 ? undefined : next) as Node<V>;
}

/** A new map with `key` set to `value`. `undefined` is not a storable value (use pmapDelete). */
export function pmapSet<V>(map: PMap<V>, key: number, value: V): PMap<V> {
  checkKey(key);
  if (value === undefined) throw new Error("pmap: undefined is not a value; use pmapDelete");
  let { root, shift } = map;
  while (key >= capacity(shift)) {
    root = root.length === 0 ? root : Object.freeze([root]);
    shift += BITS;
  }
  const had = pmapGet(map, key) !== undefined;
  if (pmapGet(map, key) === value) return map;
  return Object.freeze({ root: setIn(root, shift, key, value), shift, size: map.size + (had ? 0 : 1) });
}

export function pmapDelete<V>(map: PMap<V>, key: number): PMap<V> {
  if (pmapGet(map, key) === undefined) return map;
  return Object.freeze({ root: setIn(map.root, map.shift, key, undefined), shift: map.shift, size: map.size - 1 });
}

/** Calls `fn` for every entry, keys ascending. */
export function pmapForEach<V>(map: PMap<V>, fn: (value: V, key: number) => void): void {
  const walk = (node: Node<V>, shift: number, base: number) => {
    for (let i = 0; i < node.length; i++) {
      const slot = node[i];
      if (slot === undefined) continue;
      const key = base + i * 2 ** shift;
      if (shift === 0) fn(slot as V, key);
      else walk(slot as Node<V>, shift - BITS, key);
    }
  };
  walk(map.root, map.shift, 0);
}

/** Every entry, keys ascending. */
export function pmapEntries<V>(map: PMap<V>): [number, V][] {
  const out: [number, V][] = [];
  pmapForEach(map, (v, k) => out.push([k, v]));
  return out;
}

export function pmapValues<V>(map: PMap<V>): V[] {
  return pmapEntries(map).map(([, v]) => v);
}

export function pmapFrom<V>(entries: Iterable<[number, V]>): PMap<V> {
  let map = pmapEmpty<V>();
  for (const [k, v] of entries) map = pmapSet(map, k, v);
  return map;
}
