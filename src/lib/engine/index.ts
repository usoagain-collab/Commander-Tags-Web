// Deck Genome rules engine (Phase 1). Pure TypeScript: no React, no database, no network, so it runs the
// same in the browser, in Node and in a Cloudflare Durable Object. Design: docs/engine-design.md.

export { step, legalStartingActions, STEP_ORDER, phaseOf } from "./engine";
export { createGame, type GameSetup, type SeatSetup } from "./setup";
export { replay, newLog, type GameLog, type LoggedAction } from "./log";
export { chars } from "./chars";
export { printedFace, castableFaces, playableLandFaces, face, LAYOUT_SUPPORT } from "./cards";
export { stateDigest } from "./digest";
export { checkInvariants } from "./invariants";
export { SPECIAL_ACTIONS } from "./special";
export { RULES, CR_DATE } from "./rules-refs";
export { ENGINE_VERSION } from "./version";
export type * from "./types";
