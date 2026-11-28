// Prints a short sample game, written out as a log anyone can read (the PR 1 "what can it do now" note).
// Two players with lands and vanilla creatures: each plays a land and casts what it can afford.
// Usage: npm run engine:sample [-- turns]
import { createGame, step, chars, type GameEvent, type GameState, type Action } from "@/lib/engine";
import { pmapGet } from "@/lib/engine/pmap";
import { BEARS, deckOf, FOREST, HILL_GIANT, MOUNTAIN, PLAINS, SAVANNAH_LIONS, QUICK_SPELL, ISLAND } from "@/lib/engine/test-cards";

const turns = Number(process.argv[2] ?? 6);
const deckA = deckOf([FOREST, 1], [BEARS, 1], [FOREST, 1], [MOUNTAIN, 1], [BEARS, 1], [HILL_GIANT, 1], [FOREST, 1], [MOUNTAIN, 1], [FOREST, 12]);
const deckB = deckOf([PLAINS, 1], [SAVANNAH_LIONS, 2], [ISLAND, 1], [QUICK_SPELL, 1], [PLAINS, 1], [SAVANNAH_LIONS, 1], [PLAINS, 13]);
const who = (seat: number) => (seat === 0 ? "Ana" : "Ben");

function name(s: GameState, before: GameState, id: number): string {
  const o = pmapGet(s.objects, id) ?? pmapGet(before.objects, id);
  if (!o) return `object ${id}`;
  try {
    return chars(pmapGet(s.objects, id) ? s : before, id).name;
  } catch {
    return o.def.faces[0].name;
  }
}

function say(e: GameEvent, s: GameState, before: GameState): string | null {
  switch (e.type) {
    case "turnBegin": return `\nTurn ${e.turn}: ${who(e.seat)}`;
    case "stepBegin": return null;
    case "draw": return `  ${who(e.seat)} draws ${name(s, before, e.object)}.`;
    case "landPlayed": return `  ${who(e.seat)} plays ${name(s, before, e.object)}.`;
    case "tap": return `  ${name(s, before, e.object)} taps.`;
    case "manaAdded": return null;
    case "manaSpent": return null;
    case "cast": return `  ${who(e.seat)} casts ${name(s, before, e.object)} (on the stack).`;
    case "resolve": return `  ${name(s, before, e.object)} resolves.`;
    case "zoneChange": return e.to === "battlefield" && e.from === "stack" ? `  ${name(s, before, e.newId)} enters the battlefield.` : null;
    case "discard": return `  ${who(e.seat)} discards ${name(s, before, e.object)}.`;
    case "castRolledBack": return `  ${who(e.seat)} tries a spell but ${e.reason === "cancelled" ? "can't pay for it" : e.reason}, so the cast is undone and nothing changed.`;
    case "lose": return `  ${who(e.seat)} loses: ${e.reason}.`;
    case "gameOver": return `Game over. Winner: ${e.winner === null ? "nobody" : who(e.winner)}.`;
    default: return null;
  }
}

/** A tiny player: play a land, cast the first creature it can afford, otherwise pass. */
function choose(s: GameState): Action {
  const d = s.pendingDecision!;
  if (d.kind === "chooseObjects") return { kind: "answer", decision: d.id, choice: { objects: d.candidates!.slice(0, d.min) } };
  if (d.kind === "payCost") {
    const auto = d.options.find((o) => o.kind === "answer" && "pay" in o.choice);
    return auto ?? { kind: "answer", decision: d.id, choice: { cancel: true } };
  }
  const mine = s.turn.activeSeat === d.seat && (s.turn.step === "main1") && s.zones.stack.length === 0;
  if (mine) {
    const land = d.options.find((o) => o.kind === "playLand");
    if (land) return land;
    const tried = triedThisStep.get(d.seat) ?? new Set<number>();
    // Tries each card once a step; the first unaffordable try shows the rollback, the rest are skipped.
    const cast = d.options.find((o) => o.kind === "cast" && !tried.has(o.object) && (shownRollback < 1 || chars(s, o.object).manaValue <= untapped(s, d.seat)));
    if (cast && cast.kind === "cast") {
      tried.add(cast.object);
      triedThisStep.set(d.seat, tried);
      return cast;
    }
  }
  return { kind: "pass" };
}
const triedThisStep = new Map<number, Set<number>>();
let shownRollback = 0;
const untapped = (s: GameState, seat: number) =>
  s.zones.battlefield.filter((id) => { const o = pmapGet(s.objects, id)!; return o.controller === seat && !o.status.tapped && chars(s, id).types.includes("Land"); }).length;

const start = createGame({ seed: "sample", seats: [{ deck: deckA }, { deck: deckB }], firstSeat: 0, libraryOrder: "asListed" });
let s = start.state;
const lines: string[] = [`Sample game, engine ${s.engineVersion}. Ana and Ben each start at 40 life with 7 cards.`];
for (const e of start.events) {
  const line = say(e, s, s);
  if (line) lines.push(line);
}
let lastStep = "";
while (!s.over && s.turn.number <= turns) {
  if (s.turn.step !== lastStep) {
    triedThisStep.clear();
    lastStep = s.turn.step;
  }
  const before = s;
  const action = choose(s);
  const r = step(s, s.pendingDecision!.seat, action);
  if (r.error) throw new Error(r.error);
  s = r.state;
  if (r.events.some((e) => e.type === "castRolledBack")) shownRollback++;
  for (const e of r.events) {
    const line = say(e, s, before);
    if (line) lines.push(line);
  }
}
const board = (seat: number) => s.zones.battlefield.filter((id) => pmapGet(s.objects, id)!.controller === seat).map((id) => chars(s, id).name);
lines.push(`\nAfter ${turns} turns: Ana has ${board(0).join(", ")}; Ben has ${board(1).join(", ")}.`);
console.log(lines.join("\n"));
