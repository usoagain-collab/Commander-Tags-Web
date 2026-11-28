// The special-action slot (rule 116.2). Special actions don't use the stack. Playing a land (116.2a) has its
// own action kind and works in PR 1; every other one has its place here and is made to work only when a
// top-500 card needs it (engine-design.md section 3).

import type { SpecialKind } from "./types";

export type SpecialRow = { rule: string; what: string; phase1: "yes" | "shape" | "no"; works: boolean };

export const SPECIAL_ACTIONS: Record<SpecialKind, SpecialRow> = {
  turnFaceUp: { rule: "116.2b", what: "Turn a face-down creature face up", phase1: "shape", works: false },
  endEffect: { rule: "116.2c", what: "Take a later action to end an effect or stop a delayed trigger", phase1: "shape", works: false },
  ignoreStatic: { rule: "116.2d", what: "Take an action to ignore a static ability's effect for a while", phase1: "shape", works: false },
  circlingVultures: { rule: "116.2e", what: "Discard Circling Vultures", phase1: "no", works: false },
  suspend: { rule: "116.2f", what: "Exile a card with suspend from hand", phase1: "shape", works: false },
  companion: { rule: "116.2g", what: "Pay {3} to put your companion into your hand", phase1: "yes", works: false }, // PR 3
  foretell: { rule: "116.2h", what: "Foretell", phase1: "shape", works: false },
  planarDie: { rule: "116.2i", what: "Roll the planar die", phase1: "no", works: false },
  conspiracy: { rule: "116.2j", what: "Turn a face-down conspiracy face up", phase1: "no", works: false },
  plot: { rule: "116.2k", what: "Plot", phase1: "shape", works: false },
  unlockRoom: { rule: "116.2m", what: "Unlock a Room's locked half", phase1: "shape", works: false },
};

export function specialRefusal(kind: SpecialKind): string {
  const row = SPECIAL_ACTIONS[kind];
  if (!row) return `unknown special action "${kind}"`;
  return `not yet: ${row.what} (${row.rule}) isn't built in this engine version`;
}
