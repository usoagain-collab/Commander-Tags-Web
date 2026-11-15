// Plays-like check (bracket rethink, step 1): runs the power estimate, sample games included, on real decks
// straight from the database, so the threat turn and every part can be judged and tuned before David sees it.
// Read-only. Run: npm run bracket:check              (the Omo test deck and every "QA: …" deck)
//            npm run bracket:check -- --precons  (every precon, plus how many play like each bracket)
//            npm run bracket:check -- <deck id> …  (just those decks)
import pg from "pg";
import { estimateBracket } from "@/lib/brackets/evaluate";
import { bracketRolesOf, estimatePower } from "@/lib/brackets/power";
import { BRACKET_RULES } from "@/lib/brackets/rules";
import { SPEED, speedSlugs, turnWords } from "@/lib/brackets/speed";
import { detectArchetypes, type CutterCard } from "@/lib/cutter/archetype";
import { ARCHETYPES, GENERAL_KEY } from "@/lib/cutter/archetypes";
import type { CardSummary, DeckLine } from "@/lib/deck/model";
import { readPlays } from "@/lib/tags/plays";
import { isLand } from "@/lib/tags/roles";
import { cardKeys, themeTags, type ThemeCard } from "@/lib/tags/themes";
import { TagTree } from "@/lib/tags/tree";

const OMO = "7364f160-46e9-4365-a779-53969cc0f445";
const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error("SUPABASE_DB_URL is not set in .env.local");
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

const tree = new TagTree((await db.query("select public.oracle_tag_tree() as t")).rows[0].t);
const missing = speedSlugs().filter((s) => !tree.has(s));
console.log(missing.length ? `⚠ Sample-game tags not in the tag tree: ${missing.join(", ")}` : "All sample-game tags exist in the tag tree.");

const args = process.argv.slice(2);
const precons = args.includes("--precons");
const ids: string[] = precons
  ? (await db.query("select id from decks where precon is not null order by name")).rows.map((r) => r.id)
  : args.length
    ? args
    : [OMO, ...(await db.query("select id from decks where name like 'QA:%' order by name")).rows.map((r) => r.id)];

const tally = new Map<number, string[]>();
const turns: number[] = [];
const started = performance.now();
for (const id of ids) {
  const b = (await db.query("select public.deck_bundle($1) as b", [id])).rows[0].b;
  if (!b) {
    console.log(`\n${id}: not found`);
    continue;
  }
  const cards = new Map<string, CardSummary>(b.cards.map((c: CardSummary) => [c.oracle_id, c]));
  const tagsOf = (oid: string): string[] => b.tags?.o?.[oid] ?? [];
  type Row = { oracle_id: string; board: string; quantity: number };
  const lines: DeckLine[] = (b.rows as Row[])
    .filter((r) => r.board !== "maybe" && cards.has(r.oracle_id))
    .map((r) => ({ board: r.board as DeckLine["board"], quantity: r.quantity, card: cards.get(r.oracle_id)! }));
  const rolesOf = bracketRolesOf(tree, tagsOf);
  const estimate = estimateBracket({
    lines,
    tagsOf,
    massLandDenialTags: tree.descendants(BRACKET_RULES.tags.massLandDenial),
    extraTurnTags: tree.descendants(BRACKET_RULES.tags.extraTurn),
    combos: b.combos ?? [],
  });

  // Themes and archetype as the editor computes them: top 5 gameplay themes, the Plays pick or the best guess.
  const deckLines = lines.filter((l) => l.board === "commander" || l.board === "main");
  const themeCard = (l: DeckLine): ThemeCard => ({ oracle: tagsOf(l.card.oracle_id), art: [], commander: l.board === "commander", land: isLand(l.card.type_line) });
  const trees = { oracle: tree, art: null };
  const themes = themeTags(deckLines.map(themeCard), { settings: { mode: "gameplay", specific: true, sortBy: "relevance" }, trees, roleTags: new Set(), hidden: new Set() }).slice(0, 15);
  const cutterCards: CutterCard[] = deckLines.map((l) => ({ card: l.card, quantity: l.quantity, commander: l.board === "commander", tags: tagsOf(l.card.oracle_id), roles: rolesOf(l) }));
  const ranked = detectArchetypes({ cards: cutterCards, tree, combos: (b.combos ?? []).length });
  const pick = readPlays(b.deck.plays).archetype;
  const picked = pick ? ARCHETYPES.find((a) => a.key === pick) : undefined;
  const archetype = picked
    ? { archetype: picked, picked: true }
    : ranked[0] && ranked[0].archetype.key !== GENERAL_KEY
      ? { archetype: ranked[0].archetype, picked: false }
      : null;

  const t0 = performance.now();
  const power = estimatePower({
    lines,
    rolesOf,
    tagsOf,
    counterTags: tree.descendants(["counterspell"].filter((t) => tree.has(t))),
    topThemes: new Set(themes.filter((t) => !t.pinned).slice(0, 5).map((t) => t.key)),
    themeKeysOf: (l) => cardKeys({ oracle: tagsOf(l.card.oracle_id), art: [], commander: false, land: false }, true, trees),
    estimate,
    tree,
    archetype,
  });
  const ms = performance.now() - t0;
  const s = power.speed!;
  tally.set(power.playsLike, [...(tally.get(power.playsLike) ?? []), b.deck.name]);
  turns.push(s.turn);

  const name = (oid: string) => cards.get(oid)?.name ?? oid;
  if (precons) {
    console.log(`${String(power.playsLike).padStart(2)} ${String(power.score).padStart(3)}  ${turnWords(s.turn).padEnd(14)} ${s.route.label.padEnd(18)} ${b.deck.name}`);
    continue;
  }
  console.log(`\n━━ ${b.deck.name} ━━`);
  console.log(`Plays like ${power.playsLike} (points ${power.score}, rules floor ${estimate.floor}) · threatens a win around ${turnWords(s.turn)} (fast ${turnWords(s.fast)}) · route: ${s.route.label}`);
  console.log(`Archetype: ${archetype ? `${archetype.archetype.name} (${archetype.picked ? "picked" : "detected"})` : "General"}`);
  for (const r of s.routes)
    console.log(`  ${r.label.padEnd(18)} median ${turnWords(r.median).padEnd(14)} fast ${turnWords(r.fast).padEnd(14)} first in ${Math.round(r.first * 100)}% · ${r.pieces}${r.cards.length ? `: ${r.cards.slice(0, 8).map(name).join(", ")}${r.cards.length > 8 ? " …" : ""}` : ""}`);
  for (const p of power.parts) console.log(`  ${p.label.padEnd(18)} ${String(p.points).padStart(5)} / ${p.max}  ${p.detail}`);
  console.log(`  (${SPEED.games} sample games in ${ms.toFixed(0)} ms)`);
}

console.log(`\nPlays like: ${[1, 2, 3, 4].map((n) => `${n}: ${tally.get(n)?.length ?? 0}`).join(" · ")} of ${ids.length} decks`);
if (precons) {
  const two = (tally.get(2)?.length ?? 0) / ids.length;
  console.log(`Precons at 2: ${Math.round(two * 100)}% (aim: 85% or more, none at 4)`);
  for (const n of [1, 3, 4]) if (tally.get(n)?.length) console.log(`  Plays like ${n}: ${tally.get(n)!.join("; ")}`);
}
const sorted = turns.slice().sort((a, b) => a - b);
if (sorted.length) console.log(`Threat turn: median ${turnWords(sorted[Math.floor(sorted.length / 2)])}, fastest ${turnWords(sorted[0])}, slowest ${turnWords(sorted.at(-1)!)}`);
console.log(`Total ${((performance.now() - started) / 1000).toFixed(1)} s`);
await db.end();
