// Smart Cutter check (step C1): runs the cutter engine on real decks straight from the database and prints the
// detected archetype and the suggested cuts, so the results can be judged before there is any UI.
// Read-only. Run: npm run cutter:check            (the Omo test deck and every "QA: …" deck)
//            npm run cutter:check -- <deck id> …  (just those decks)
import pg from "pg";
import { estimateBracket, overTarget } from "@/lib/brackets/evaluate";
import { BRACKET_RULES, type BracketNumber } from "@/lib/brackets/rules";
import { archetypeLabel, cheatTargets, detectArchetypes, type CutterCard } from "@/lib/cutter/archetype";
import { ARCHETYPES, archetypeSlugs } from "@/lib/cutter/archetypes";
import { keepScores, suggestCuts, type CardScore, type CutterContext } from "@/lib/cutter/score";
import type { CardSummary, DeckLine } from "@/lib/deck/model";
import { buildRoleDefs, hiddenRoleKeys, readCustomRoles, readTargets } from "@/lib/tags/role-settings";
import { isLand, resolveRoles, rolesOf } from "@/lib/tags/roles";
import { cardKeys, themeTags, type ThemeCard } from "@/lib/tags/themes";
import { TagTree } from "@/lib/tags/tree";

const OMO = "7364f160-46e9-4365-a779-53969cc0f445";
const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error("SUPABASE_DB_URL is not set in .env.local");
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

const tree = new TagTree((await db.query("select public.oracle_tag_tree() as t")).rows[0].t);
const missing = archetypeSlugs().filter((s) => !tree.has(s));
console.log(missing.length ? `⚠ Archetype tags not in the tag tree: ${missing.join(", ")}` : "All archetype tags exist in the tag tree.");

const ids: string[] = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [OMO, ...(await db.query("select id from decks where name like 'QA:%' order by name")).rows.map((r) => r.id)];

const pct = (n: number) => `${Math.round(n * 100)}`.padStart(3);
const short = (s: CardScore) =>
  `coverage ${pct(s.parts.coverage)} · saturation ${pct(s.parts.saturation)} · weakest ${pct(s.parts.weakest)} · theme ${pct(s.parts.theme)} · curve ${pct(s.parts.curve)}`;

for (const id of ids) {
  const b = (await db.query("select public.deck_bundle($1) as b", [id])).rows[0].b;
  if (!b) {
    console.log(`\n${id}: not found`);
    continue;
  }
  const started = performance.now();
  const cards = new Map<string, CardSummary>(b.cards.map((c: CardSummary) => [c.oracle_id, c]));
  const tagsOf = (oid: string): string[] => b.tags?.o?.[oid] ?? [];
  const hidden = new Set<string>(
    (await db.query("select hidden_tags from profiles where id = $1", [b.deck.owner_id])).rows[0]?.hidden_tags ?? [],
  );
  const targets = readTargets(b.deck.role_targets);
  const allRoles = resolveRoles(buildRoleDefs(targets, readCustomRoles(b.deck.custom_roles)), tree);
  const hiddenRoles = hiddenRoleKeys(targets);
  const roles = allRoles.filter((r) => !hiddenRoles.has(r.key));

  type Row = { oracle_id: string; board: string; quantity: number; category: string | null };
  const rows: Row[] = b.rows;
  const deckRows = rows.filter((r) => (r.board === "commander" || r.board === "main") && cards.has(r.oracle_id));
  const roleKeys = (r: Row) => {
    if (r.category === "none") return [];
    if (r.category && roles.some((x) => x.key === r.category)) return [r.category];
    return rolesOf(cards.get(r.oracle_id)!, tagsOf(r.oracle_id), allRoles).filter((k) => !hiddenRoles.has(k));
  };
  const cutterCards: CutterCard[] = deckRows.map((r) => ({
    card: cards.get(r.oracle_id)!,
    quantity: r.quantity,
    commander: r.board === "commander",
    tags: tagsOf(r.oracle_id),
    roles: roleKeys(r),
  }));

  const trees = { oracle: tree, art: null };
  const roleTags = new Set(roles.flatMap((r) => (r.tagSet ? [...r.tagSet] : [])));
  const themeCard = (c: CutterCard): ThemeCard => ({ oracle: c.tags, art: [], commander: c.commander, land: isLand(c.card.type_line) });
  const themesFor = (list: CutterCard[]) =>
    themeTags(list.map(themeCard), { settings: { mode: "gameplay", specific: true, sortBy: "relevance" }, trees, roleTags, hidden }).slice(0, 15);

  const bracketLines: DeckLine[] = rows
    .filter((r) => r.board !== "maybe" && cards.has(r.oracle_id))
    .map((r) => ({ board: r.board as DeckLine["board"], quantity: r.quantity, card: cards.get(r.oracle_id)! }));
  const estimate = estimateBracket({
    lines: bracketLines,
    tagsOf,
    massLandDenialTags: tree.descendants(BRACKET_RULES.tags.massLandDenial),
    extraTurnTags: tree.descendants(BRACKET_RULES.tags.extraTurn),
    combos: b.combos ?? [],
  });
  const identity = new Set(cutterCards.filter((c) => c.commander).flatMap((c) => c.card.color_identity));

  const ranked = detectArchetypes({ cards: cutterCards, tree, combos: (b.combos ?? []).length });
  const archetype = ranked[0].archetype;
  const ctx: CutterContext = {
    cards: cutterCards,
    roles,
    tree,
    themes: themesFor(cutterCards),
    themesFor,
    keysOf: (c) => cardKeys(themeCard(c), true, trees),
    archetype,
    combos: b.combos ?? [],
    bracketFindings: overTarget(estimate, (b.deck.target_bracket ?? 3) as BracketNumber),
    identity: identity.size ? identity : null,
  };
  const prepMs = performance.now() - started;
  const t0 = performance.now();
  const scores = keepScores(ctx);
  const scoreMs = performance.now() - t0;
  const t1 = performance.now();
  const plan = suggestCuts(ctx);
  const planMs = performance.now() - t1;

  console.log(`\n━━ ${b.deck.name} (${plan.size} cards) ━━`);
  console.log(
    "Archetypes: " +
      ranked
        .slice(0, 3)
        .map((d) => `${archetypeLabel(d)} ${Math.round(d.score * 100)}` + (d.evidence[0] ? ` [${d.evidence[0].label}: ${d.evidence[0].count}]` : ""))
        .join(" · "),
  );
  const cheat = cheatTargets(cutterCards, tree, archetype);
  if (cheat.targets.size)
    console.log(`Cheated in (${cheat.enablers} enablers): ${[...cheat.targets].map((x) => cards.get(x)?.name).join(", ")}`);
  console.log(
    `Top themes: ${ctx.themes.slice(0, 5).map((t) => `${t.label} ${t.count}`).join(", ")} · cards with theme fit > 0: ${scores.filter((s) => !s.entry.commander && s.parts.theme > 0).length}`,
  );
  const protectedBy = new Map<string, number>();
  for (const s of scores) if (s.protect) protectedBy.set(s.protect.kind, (protectedBy.get(s.protect.kind) ?? 0) + 1);
  console.log(`Protected: ${[...protectedBy].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`);
  if (plan.mode === "under") {
    console.log(`Under 100: needs ${plan.need}. Under target: ${plan.under.map((r) => `${r.name} ${r.count}/${r.target}`).join(", ") || "none"}`);
  } else {
    console.log(plan.mode === "over" ? `Cut ${plan.cuts.length} to reach 100:` : "Exactly 100. Weakest 3:");
    for (const { score: s } of plan.cuts) {
      const roleText = s.facts.roles.map((r) => `${r.name} ${r.count}/${r.target}`).join(", ") || "no role";
      const rank = s.facts.ranks.map((r) => `${r.position}/${r.of} in ${r.name}`).join(", ");
      const flags = [...s.flags.bracket, s.flags.strain ? `strain ${s.flags.strain}` : ""].filter(Boolean).join("; ");
      console.log(`  ${pct(s.keep)}  ${s.entry.card.name} (mv ${s.entry.card.mana_value}) — ${roleText}${rank ? `; ${rank}` : ""}`);
      console.log(`       ${short(s)}${flags ? `  ⚑ ${flags}` : ""}`);
    }
  }
  console.log(`Time: setup ${prepMs.toFixed(0)} ms · one scoring pass ${scoreMs.toFixed(0)} ms · cut plan ${planMs.toFixed(0)} ms`);
}
console.log(`\nArchetypes in the starter set: ${ARCHETYPES.length}`);
await db.end();
