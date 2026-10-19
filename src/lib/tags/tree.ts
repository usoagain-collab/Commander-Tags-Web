// The oracle tag tree, ported from the prototype (linkTree / descendants / ancestors / depthOf / tagPath).
// Cards are tagged at ONE level only; parents are implied by the tree (CLAUDE.md, Scryfall data facts).

/** As served by /api/tag-tree (SQL: oracle_tag_tree). */
export type TagTreePayload = {
  n: number; // distinct tagged cards: the theme score's N
  art_n: number; // distinct tagged illustrations
  tags: [slug: string, label: string, size: number, parents: number[]][];
};

export type TagInfo = { slug: string; label: string; size: number };

export class TagTree {
  readonly n: number;
  readonly artN: number;
  private slugs: string[];
  private labels: string[];
  private sizes: number[];
  private parents: number[][];
  private children: number[][];
  private index = new Map<string, number>();
  private depthCache = new Map<number, number>();
  private ancestorCache = new Map<number, number[]>();

  constructor(payload: TagTreePayload) {
    this.n = payload.n;
    this.artN = payload.art_n;
    this.slugs = payload.tags.map((t) => t[0]);
    this.labels = payload.tags.map((t) => t[1]);
    this.sizes = payload.tags.map((t) => t[2]);
    this.parents = payload.tags.map((t) => t[3]);
    this.children = this.slugs.map(() => []);
    this.parents.forEach((ps, i) => ps.forEach((p) => this.children[p].push(i)));
    this.slugs.forEach((s, i) => this.index.set(s, i));
  }

  has(slug: string) {
    return this.index.has(slug);
  }

  info(slug: string): TagInfo | null {
    const i = this.index.get(slug);
    return i === undefined ? null : { slug, label: this.labels[i], size: this.sizes[i] };
  }

  /** The tag plus everything below it. Used for roles: "ramp" includes mana rocks, dorks, land ramp... */
  descendants(rootSlugs: string[]): Set<string> {
    const out = new Set<string>();
    const stack = rootSlugs.map((s) => this.index.get(s)).filter((i): i is number => i !== undefined);
    while (stack.length) {
      const i = stack.pop()!;
      if (out.has(this.slugs[i])) continue;
      out.add(this.slugs[i]);
      stack.push(...this.children[i]);
    }
    return out;
  }

  /** Every tag above this one (not including itself). */
  ancestors(slug: string): string[] {
    const start = this.index.get(slug);
    if (start === undefined) return [];
    if (!this.ancestorCache.has(start)) {
      const seen = new Set<number>();
      const stack = [...this.parents[start]];
      while (stack.length) {
        const p = stack.pop()!;
        if (seen.has(p) || p === start) continue;
        seen.add(p);
        stack.push(...this.parents[p]);
      }
      this.ancestorCache.set(start, [...seen]);
    }
    return this.ancestorCache.get(start)!.map((i) => this.slugs[i]);
  }

  /** 1 for a top-level tag, +1 per level below it (longest path), as in the prototype. */
  depth(slug: string): number {
    const start = this.index.get(slug);
    if (start === undefined) return 1;
    const walk = (i: number, seen: Set<number>): number => {
      const cached = this.depthCache.get(i);
      if (cached !== undefined) return cached;
      if (seen.has(i)) return 1; // guard against loops in the data
      seen.add(i);
      const d = 1 + Math.max(0, ...this.parents[i].map((p) => walk(p, seen)));
      this.depthCache.set(i, d);
      return d;
    };
    return walk(start, new Set());
  }

  /** "triggered ability › death trigger": the first line of ancestry, for tooltips. */
  path(slug: string): string {
    let i = this.index.get(slug);
    if (i === undefined) return slug;
    const names = [this.labels[i]];
    const seen = new Set<number>();
    while (this.parents[i].length && !seen.has(i) && names.length < 6) {
      seen.add(i);
      i = this.parents[i][0];
      names.unshift(this.labels[i]);
    }
    return names.join(" › ");
  }

  /** A card's tags as applied, deepest (most specific) first, then by label. */
  sortDeepestFirst(slugs: string[]): string[] {
    return [...slugs].sort((a, b) => this.depth(b) - this.depth(a) || this.label(a).localeCompare(this.label(b)));
  }

  /** The first line of ancestry, top-level tag first and this tag last (for the tag tree card). */
  chain(slug: string): string[] {
    let i = this.index.get(slug);
    if (i === undefined) return [slug];
    const out = [i];
    const seen = new Set(out);
    while (this.parents[i].length && out.length < 8) {
      i = this.parents[i][0];
      if (seen.has(i)) break;
      seen.add(i);
      out.unshift(i);
    }
    return out.map((j) => this.slugs[j]);
  }

  /** Direct sub-tags of a tag. */
  childrenOf(slug: string): string[] {
    const i = this.index.get(slug);
    return i === undefined ? [] : this.children[i].map((c) => this.slugs[c]);
  }

  label(slug: string) {
    const i = this.index.get(slug);
    return i === undefined ? slug : this.labels[i];
  }
}
