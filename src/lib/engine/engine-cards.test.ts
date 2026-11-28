// PR 2 gates (the card language, dg-card/1):
//   1. every hand-written card passes its tests, and each card has 2 or more tests that run now;
//   2. every script passes the schema check, and bad scripts are refused with clear errors;
//   3. together the cards use every core block and every keyword at least once.
// Scripts and tests live in engine-cards/<first two characters of oracle id>/<oracle id>(.test).json.
// engine-cards/printed.json stands in for the card_faces table until it is migrated.
/* eslint-disable @typescript-eslint/no-explicit-any -- reading JSON files */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { face } from "./cards";
import { CORE_BLOCKS, KEYWORD_NAMES, BLOCK_BY_NAME } from "./lang/blocks";
import { cardPool, runScenario, type CardTests } from "./lang/scenario";
import type { CardScript, Json } from "./lang/script-types";
import { tokenDef, TREASURE } from "./lang/tokens";
import { formatErrors, validateScript } from "./lang/validate";
import * as TC from "./test-cards";
import type { CardDef, Color, Layout } from "./types";

const ROOT = join(__dirname, "../../../engine-cards");

type Printed = { oracleId: string; name: string; layout: Layout; faces: { name: string; manaCost: string | null; typeLine: string; oracleText: string; power?: string; toughness?: string; loyalty?: string; colors?: Color[] }[] };
const printed: Printed[] = JSON.parse(readFileSync(join(ROOT, "printed.json"), "utf8"));

const files = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => readdirSync(join(ROOT, d.name)).map((f) => join(ROOT, d.name, f)));
const scriptFiles = files.filter((f) => f.endsWith(".json") && !f.endsWith(".test.json"));
const testFiles = files.filter((f) => f.endsWith(".test.json"));

const scripts = new Map<string, { file: string; raw: unknown }>();
for (const f of scriptFiles) {
  const raw = JSON.parse(readFileSync(f, "utf8"));
  scripts.set(raw.oracleId, { file: f, raw });
}

const defs: CardDef[] = printed.map((p) => {
  const s = scripts.get(p.oracleId);
  const v = s ? validateScript(s.raw, { name: p.name, faces: p.faces.length }) : null;
  return {
    oracleId: p.oracleId,
    layout: p.layout,
    faces: p.faces.map((f) => face({ name: f.name, typeLine: f.typeLine, manaCost: f.manaCost, oracleText: f.oracleText, power: f.power ?? null, toughness: f.toughness ?? null, loyalty: f.loyalty ?? null, colors: f.colors })),
    script: v?.ok ? v.script : null,
  };
});

// Plain cards the tests use around the scripted ones (no abilities).
const plain = (name: string, typeLine: string, manaCost: string | null, pt?: string): CardDef => ({
  oracleId: `test-${name}`,
  layout: "normal",
  faces: [face({ name, typeLine, manaCost, power: pt?.split("/")[0] ?? null, toughness: pt?.split("/")[1] ?? null })],
  script: null,
});
const FILLER: CardDef[] = [
  TC.PLAINS, TC.ISLAND, TC.SWAMP, TC.MOUNTAIN, TC.FOREST, TC.BEARS, TC.SAVANNAH_LIONS, TC.HILL_GIANT, TC.ORNITHOPTER, TC.COLOSSUS, TC.QUICK_SPELL,
  plain("Blue Drake", "Creature — Drake", "{1}{U}", "1/1"),
  plain("Dusk Imp", "Creature — Imp", "{2}{B}", "2/1"),
  plain("Trinket", "Artifact", "{1}"),
  tokenDef(TREASURE),
];
const pool = cardPool([...FILLER, ...defs]);

const suites: CardTests[] = testFiles.map((f) => JSON.parse(readFileSync(f, "utf8")));

// ---------------------------------------------------------------- gate 2: schema

describe("every script passes the schema check", () => {
  it("has a script and a test file for every printed card, and nothing else", () => {
    expect(scripts.size).toBe(printed.length);
    expect(suites.length).toBe(printed.length);
    for (const p of printed) expect(scripts.has(p.oracleId), p.name).toBe(true);
    for (const s of suites) expect(scripts.has(s.card), s.card).toBe(true);
  });
  for (const p of printed) {
    it(p.name, () => {
      const s = scripts.get(p.oracleId)!;
      const v = validateScript(s.raw, { name: p.name, faces: p.faces.length });
      expect(v.ok ? "" : formatErrors(v.errors)).toBe("");
      expect(s.file.endsWith(`${p.oracleId.slice(0, 2)}/${p.oracleId}.json`)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------- gate 1: each card's tests

describe("every hand-written card passes its tests", () => {
  for (const suite of suites) {
    const name = printed.find((p) => p.oracleId === suite.card)?.name ?? suite.card;
    describe(name, () => {
      it("has at least 2 tests that run now", () => {
        expect(suite.tests.filter((t) => !t.pending).length).toBeGreaterThanOrEqual(2);
      });
      for (const t of suite.tests) {
        if (t.pending) {
          it.todo(`${t.name} (${t.pending})`);
          continue;
        }
        it(t.name, () => {
          const r = runScenario(pool, t);
          expect(r.failures.join("\n")).toBe("");
        });
      }
    });
  }
});

// ---------------------------------------------------------------- gate 3: coverage

/** Blocks and keywords a script uses. Cost parts count as their block; keywords count what they expand to. */
function usage(script: CardScript): { blocks: Set<string>; keywords: Set<string> } {
  const blocks = new Set<string>();
  const keywords = new Set<string>();
  const steps = (list: Json | undefined) => {
    for (const st of (Array.isArray(list) ? list : []) as any[]) {
      if (!st || typeof st !== "object") continue;
      if ("if" in st) {
        blocks.add("if");
        steps(st.then);
        steps(st.else);
        continue;
      }
      const [k] = Object.keys(st);
      blocks.add(k);
      const a = st[k];
      if (a && typeof a === "object") for (const f of ["do", "then", "else"]) steps(a[f]);
    }
  };
  const cost = (c: Json | undefined) => {
    for (const p of (Array.isArray(c) ? c : [c]) as any[]) {
      if (typeof p === "string") {
        if (p === "tap" || p.includes("{T}")) blocks.add("tap");
        if (p === "untap" || p.includes("{Q}")) blocks.add("untap");
      } else if (p && typeof p === "object") {
        const [k] = Object.keys(p);
        blocks.add(k === "life" ? "payLife" : k === "tapCreatures" ? "tap" : k);
      }
    }
  };
  for (const f of script.faces) {
    for (const a of f.abilities as any[]) {
      steps(a.effect);
      cost(a.cost);
      cost(a.alternative);
      cost(a.additional);
      for (const m of a.modes?.options ?? []) steps(m.effect);
      if (a.kind === "mana") blocks.add("addMana");
      if (a.kind === "keyword") {
        keywords.add(a.keyword);
        steps(a.effect);
        cost(a.cost);
        if (a.keyword === "equip") blocks.add("attach");
        if (a.keyword === "cycling") ["discard", ...(a.search ? ["search", "move", "shuffle"] : ["draw"])].forEach((b) => blocks.add(b));
      }
    }
  }
  return { blocks, keywords };
}

describe("the cards cover the language", () => {
  const used = new Set<string>();
  const kws = new Set<string>();
  for (const { raw } of scripts.values()) {
    const u = usage(raw as CardScript);
    u.blocks.forEach((b) => used.add(b));
    u.keywords.forEach((k) => kws.add(k));
  }
  it(`uses all ${CORE_BLOCKS.length} core blocks`, () => {
    expect(CORE_BLOCKS.filter((b) => !used.has(b))).toEqual([]);
  });
  it(`uses all ${KEYWORD_NAMES.length} keywords`, () => {
    expect(KEYWORD_NAMES.length).toBe(30);
    expect(KEYWORD_NAMES.filter((k) => !kws.has(k))).toEqual([]);
  });
  it("uses only blocks the language has", () => {
    expect([...used].filter((b) => !BLOCK_BY_NAME[b] && !["tapCreatures"].includes(b))).toEqual([]);
  });
});

// ---------------------------------------------------------------- gate 2: bad scripts are refused

describe("bad scripts are refused with clear errors", () => {
  const base = () => ({
    schema: "dg-card/1",
    oracleId: "00000000-0000-0000-0000-000000000000",
    name: "Test Card",
    faces: [{ abilities: [{ kind: "spell", targets: [{ id: "t", select: { kind: "player" } }], effect: [{ draw: { amount: 2, player: "$t" } }] }] }],
  });
  const errors = (raw: unknown, faces = 1) => {
    const v = validateScript(raw, { name: "Test Card", faces });
    return v.ok ? "" : formatErrors(v.errors);
  };
  const withEffect = (effect: unknown) => {
    const s: any = base();
    s.faces[0].abilities[0].effect = effect;
    return s;
  };

  it("accepts the base script", () => expect(errors(base())).toBe(""));
  it("not an object", () => expect(errors("draw two")).not.toBe(""));
  it("missing language version", () => {
    const s: any = base();
    delete s.schema;
    expect(errors(s)).toMatch(/^schema: .*dg-card\/1/);
  });
  it("a newer language version", () => expect(errors({ ...base(), schema: "dg-card/9" })).toMatch(/schema: this engine runs dg-card\/1, not "dg-card\/9"/));
  it("wrong card name", () => expect(errors({ ...base(), name: "Other Card" })).toMatch(/^name: /m));
  it("wrong face count", () => expect(errors(base(), 2)).toMatch(/faces/));
  it("unknown block", () => expect(errors(withEffect([{ explode: 3 }]))).toMatch(/faces\[0\]\.abilities\[0\]\.effect\[0\]\.explode: "explode" is not a dg-card\/1 block/));
  it("unknown field in a block", () => expect(errors(withEffect([{ draw: { amount: 1, cards: 2 } }]))).toMatch(/effect\[0\]\.draw\.cards: unknown field "cards"/));
  it("missing required field", () => expect(errors(withEffect([{ addMana: { player: "you" } }]))).toMatch(/effect\[0\]\.addMana: addMana needs "mana"/));
  it("unbound variable", () => expect(errors(withEffect([{ draw: { amount: 1, player: "$nobody" } }]))).toMatch(/effect\[0\]\.draw\.player: .*\$nobody/));
  it("unknown keyword", () => {
    const s: any = base();
    s.faces[0].abilities.push({ kind: "keyword", keyword: "flamboyance" });
    expect(errors(s)).toMatch(/abilities\[1\]\.keyword: "flamboyance" is not a dg-card\/1 keyword/);
  });
  it("continuous effect in the wrong layer", () => {
    const s: any = base();
    s.faces[0].abilities.push({ kind: "static", effects: [{ continuous: { layer: "1", affects: { type: "creature" }, do: { gainAbility: { keyword: "flying" } } } }] });
    expect(errors(s)).toMatch(/not layer 1 \(613\.1\)/);
  });
  it("reports every error, each with its path", () => {
    const out = errors({ ...withEffect([{ explode: 1 }, { draw: { amount: 1, player: "$nobody" } }]), schema: "dg-card/9" });
    expect(out.split("\n").length).toBeGreaterThanOrEqual(3);
  });
});
