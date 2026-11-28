// Every Comprehensive Rules number the engine cites, in one place, so a renumbering is one edit
// (docs/engine-rules-cut.md, "Lesson for later docs"). Numbers are from the June 19, 2026 rules
// unless a note says otherwise; 613.8, 800.4a and 903.9a/b still need a re-read in the 2026 text.

export const CR_DATE = "2026-06-19";

export const RULES = {
  turnOrder: "101.4", // APNAP order for simultaneous choices
  firstDrawSkipTwoPlayer: "103.8a",
  firstDrawMultiplayer: "103.8c",
  loopGuard: "104.4b",
  specialActions: "116.2",
  playLand: "116.2a",
  companion: "116.2g",
  priorityAfterResolve: "117.3b",
  priorityAfterCast: "117.3c",
  allPass: "117.4",
  landPerTurn: "305.2",
  intrinsicMana: "305.6",
  sorceryTiming: "307.1",
  newObject: "400.7",
  libraryTopIsHidden: "401.2",
  manaEmpties: "500.4",
  untapStep: "502",
  noAttackersSkip: "508.8",
  cleanupDiscard: "514.1",
  cleanupDamage: "514.2",
  casting: "601.2",
  manaMidPayment: "601.2g",
  manaAbilityNoStack: "605.3",
  resolvePermanent: "608.3",
  resolveInstantSorcery: "608.2n",
  layers: "613",
  sbaLife: "704.5a",
  sbaEmptyDraw: "704.5b",
  sbaPoison: "704.5c",
  sbaToughness: "704.5f",
  sbaDamage: "704.5g",
  sbaLoyalty: "704.5i",
  sbaLegend: "704.5j",
  faceDown: "708",
  splitCards: "709.4",
  dfcFrontOnly: "712.8a",
  mdfcFaceCast: "712.8f",
  adventureExile: "715.4",
  shortcuts: "732",
  illegalActions: "733",
  playerLeaves: "800.4a",
  commanderToCommandSba: "903.9a",
  commanderToCommandReplacement: "903.9b",
} as const;

export type RuleKey = keyof typeof RULES;
