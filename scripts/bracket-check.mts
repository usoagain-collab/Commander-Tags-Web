// Plays-like check (bracket rethink, steps 1 and 2): runs the power estimate, sample games included, on real decks
// straight from the database, so the threat turn and every part can be judged and tuned before David sees it.
// Read-only. Run: npm run bracket:check              (the Omo test deck and every "QA: …" deck)
//            npm run bracket:check -- --precons  (every precon, plus how many play like each bracket)
//            npm run bracket:check -- <deck id> …  (just those decks)
import pg from "pg";
import { estimateBracket } from "@/lib/brackets/evaluate";
import { bracketRolesOf, estimatePower, FREE_SPELLS, powerSlugs } from "@/lib/brackets/power";
import { BRACKET_RULES } from "@/lib/brackets/rules";
import { SPEED, speedSlugs, turnWords } from "@/lib/brackets/speed";
import { detectArchetypes, type CutterCard } from "@/lib/cutter/archetype";
import { ARCHETYPES, GENERAL_KEY } from "@/lib/cutter/archetypes";
import type { CardSummary, DeckLine } from "@/lib/deck/model";
import { readPlays } from "@/lib/tags/plays";
import { CREATURE_ONLY_COUNTERS, resolveRoles, rolesOf as roleKeys, STANDARD_ROLES } from "@/lib/tags/roles";
import { TagTree } from "@/lib/tags/tree";

const OMO = "7364f160-46e9-4365-a779-53969cc0f445";
const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error("SUPABASE_DB_URL is not set in .env.local");
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

const tree = new TagTree((await db.query("select public.oracle_tag_tree() as t")).rows[0].t);
const missing = speedSlugs().filter((s) => !tree.has(s));
console.log(missing.length ? `⚠ Sample-game tags not in the tag tree: ${missing.join(", ")}` : "All sample-game tags exist in the tag tree.");
// Step 2's parts read these tags; a missing one just counts nothing, so list them for tuning.
const partMissing = powerSlugs().filter((s) => !tree.has(s));
console.log(`Part tags in the tree: ${powerSlugs().filter((s) => tree.has(s)).join(", ") || "none"}${partMissing.length ? ` · ⚠ missing: ${partMissing.join(", ")}` : ""}`);
// Tags near the ones we guessed, so a missing slug can be swapped for the real one.
{
  const near = (re: RegExp) => (tree as unknown as { slugs: string[] }).slugs.filter((s) => re.test(s)).slice(0, 25).join(", ");
  console.log(`  tags like cantrip/scry/selection: ${near(/cantrip|^scry|surveil|^loot|selection/)}`);
  console.log(`  tags like tax/stax/hatebear: ${near(/tax|stax|hatebear|rule-of-law|hate-/)}`);
  console.log(`  tags like free/pitch: ${near(/^free|pitch|alternative-cost|alt-cost/)}`);
  console.log(`  tags like cost-reducer: ${near(/^cost-reducer/)}`);
}

// Counterspells in Targeted removal and Protection (David, Nov 15): which creature-only counter tags exist, and the
// roles three test cards get.
console.log(`Creature-only counter tags in the tree: ${CREATURE_ONLY_COUNTERS.filter((t) => tree.has(t)).join(", ") || "none (check the slug)"}`);
{
  const names = ["Counterspell", "Negate", "Essence Scatter", "Swords to Plowshares"];
  const rows = (await db.query("select oracle_id, name, type_line from cards where name = any($1)", [names])).rows;
  const tagsBy = (await db.query("select public.card_tags_for($1) as t", [rows.map((r) => r.oracle_id)])).rows[0].t?.o ?? {};
  const roles = resolveRoles(STANDARD_ROLES, tree);
  for (const r of rows) console.log(`  ${r.name}: roles ${roleKeys(r, tagsBy[r.oracle_id] ?? [], roles).join(", ") || "none"} · tags ${(tagsBy[r.oracle_id] ?? []).filter((t: string) => /counter/.test(t)).join(", ")}`);
}

{
  const rows = (await db.query("select name from cards where name = any($1)", [[...FREE_SPELLS]])).rows.map((r) => r.name);
  const absent = [...FREE_SPELLS].filter((n) => !rows.includes(n));
  console.log(`Free spells list: ${rows.length} of ${FREE_SPELLS.size} names found${absent.length ? ` · not found: ${absent.join(", ")}` : ""}`);
}

const args = process.argv.slice(2);
const precons = args.includes("--precons");
const ids: string[] = precons
  ? (await db.query("select id from decks where precon is not null order by name")).rows.map((r) => r.id)
  : args.length
    ? args
    : [OMO, ...(await db.query("select id from decks where name like 'QA:%' order by name")).rows.map((r) => r.id)];

const tally = new Map<number, string[]>();
const turns: number[] = [];
const scores: number[] = [];
const floors: number[] = [];
const partSums: number[][] = Array.from({ length: 6 }, () => []);
let partNames: string[] = [];
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

  // Archetype as the editor computes it: the Plays pick or the best guess.
  const deckLines = lines.filter((l) => l.board === "commander" || l.board === "main");
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
    estimate,
    tree,
    archetype,
  });
  const ms = performance.now() - t0;
  partNames = power.parts.map((p) => p.label);
  const s = power.speed!;
  tally.set(power.playsLike, [...(tally.get(power.playsLike) ?? []), b.deck.name]);
  turns.push(s.turn);

  const name = (oid: string) => cards.get(oid)?.name ?? oid;
  if (precons) {
    // Bracket, points, rules floor, threat turn, route, then each part's points (for tuning the bands), deck name.
    const short = power.parts.map((p) => `${p.key.slice(0, 5)} ${Math.round(p.points * 10) / 10}`).join(", ");
    partSums.forEach((arr, i) => arr.push(power.parts[i]?.points ?? 0));
    scores.push(power.score);
    floors.push(estimate.floor);
    console.log(`${String(power.playsLike).padStart(2)} ${String(power.score).padStart(3)} floor ${estimate.floor}  ${turnWords(s.turn).padEnd(14)} ${s.route.label.padEnd(18)} ${b.deck.name}  [${short}]`);
    continue;
  }
  console.log(`\n━━ ${b.deck.name} ━━`);
  console.log(`Plays like ${power.playsLike} (points ${power.score}, rules floor ${estimate.floor}) · threatens a win around ${turnWords(s.turn)} (fast ${turnWords(s.fast)}) · route: ${s.route.label}`);
  console.log(`Archetype: ${archetype ? `${archetype.archetype.name} (${archetype.picked ? "picked" : "detected"})` : "General"}`);
  for (const r of s.routes)
    console.log(`  ${r.label.padEnd(18)} median ${turnWords(r.median).padEnd(14)} fast ${turnWords(r.fast).padEnd(14)} first in ${Math.round(r.first * 100)}% · ${r.pieces}${r.cards.length ? `: ${r.cards.slice(0, 8).map(name).join(", ")}${r.cards.length > 8 ? " …" : ""}` : ""}`);
  for (const p of power.parts) console.log(`  ${p.label.padEnd(18)} ${String(p.points).padStart(5)} / ${p.max}  ${p.detail}`);
  if (power.whyNotHigher) console.log(`  Why not higher: ${power.whyNotHigher}`);
  console.log(`  (${SPEED.games} sample games in ${ms.toFixed(0)} ms)`);
}

console.log(`\nPlays like: ${[1, 2, 3, 4].map((n) => `${n}: ${tally.get(n)?.length ?? 0}`).join(" · ")} of ${ids.length} decks`);
if (precons) {
  const two = (tally.get(2)?.length ?? 0) / ids.length;
  console.log(`Precons at 2: ${Math.round(two * 100)}% (aim: 85% or more, none at 4)`);
  for (const n of [1, 3, 4]) if (tally.get(n)?.length) console.log(`  Plays like ${n}: ${tally.get(n)!.join("; ")}`);
  const sc = scores.slice().sort((a, b) => a - b);
  const at = (q: number) => sc[Math.min(sc.length - 1, Math.floor(q * sc.length))];
  const fromRules = floors.filter((f) => f >= 3).length;
  console.log(`Rules floor alone puts ${fromRules} of ${ids.length} precons at 3 or 4 (${Math.round((fromRules / ids.length) * 100)}%), whatever the points`);
  // Band sweep: share at 2 for other cutoffs (plays like = the higher of the rules floor and the band).
  const sweep: string[] = [];
  for (const low of [10, 15, 20, 25])
    for (const high of [35, 40, 45, 50, 55]) {
      const twos = scores.filter((sc, i) => Math.max(floors[i], sc >= high ? 3 : sc >= low ? 2 : 1) === 2).length;
      sweep.push(`2 from ${low}, 3 from ${high}: ${Math.round((twos / ids.length) * 100)}%`);
    }
  console.log(`Band sweep (share of precons at 2): ${sweep.join(" · ")}`);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  console.log(`Precon part averages: ${partNames.map((n, i) => `${n} ${avg(partSums[i]).toFixed(1)}`).join(" · ")}`);
  console.log(`Precon points: 5% ${at(0.05)} · 10% ${at(0.1)} · median ${at(0.5)} · 90% ${at(0.9)} · 95% ${at(0.95)} · highest ${sc.at(-1)}`);
}
const sorted = turns.slice().sort((a, b) => a - b);
if (sorted.length) console.log(`Threat turn: median ${turnWords(sorted[Math.floor(sorted.length / 2)])}, fastest ${turnWords(sorted[0])}, slowest ${turnWords(sorted.at(-1)!)}`);
console.log(`Total ${((performance.now() - started) / 1000).toFixed(1)} s`);
await db.end();
