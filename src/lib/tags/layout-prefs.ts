/** Layout choices saved in profiles.tag_view: the left column's dragged width and the card preview's mode. */

export const RAIL_MIN = 130;
export const RAIL_MAX = 1000;
// Design refresh (option E): a slimmer column by default, so the cards get the room. Saved widths are kept.
export const RAIL_DEFAULT = 232;
export const RAIL_COLLAPSED = 160;

/** compact: only roles and numbers. rail: bars and top tags too. full: the whole panel, in more columns as it widens. */
export type RailStage = "compact" | "rail" | "full";

export const clampRail = (px: number) => Math.round(Math.min(RAIL_MAX, Math.max(RAIL_MIN, px)));

export const railStage = (px: number): RailStage => (px < 150 ? "compact" : px < 250 ? "rail" : "full");

/** The saved width; before the column could be dragged, it was only a collapsed flag. */
export function railWidthOf(prefs: Record<string, unknown>) {
  if (typeof prefs.railWidth === "number" && Number.isFinite(prefs.railWidth)) return clampRail(prefs.railWidth);
  return prefs.leftCollapsed === true ? RAIL_COLLAPSED : RAIL_DEFAULT;
}

/**
 * float = the far side of the screen; beside = right next to the hovered card (David, Nov 21, 2026: on big
 * screens the far side was too far from the card); docked = its own column; off = none.
 */
export type PreviewMode = "float" | "beside" | "docked" | "off";

export const PREVIEW_LABELS: Record<PreviewMode, string> = { beside: "Next to the card", float: "Far side", docked: "Docked", off: "Off" };

export const readPreviewMode = (prefs: Record<string, unknown>): PreviewMode =>
  prefs.previewMode === "docked" || prefs.previewMode === "off" || prefs.previewMode === "beside" ? prefs.previewMode : "float";

/** Where the beside preview goes: right of the card if it fits, else left, kept inside the window. */
export function besidePosition(card: { left: number; right: number; top: number }, view: { width: number; height: number }, size = { width: 270, height: 520 }) {
  const gap = 12;
  const right = card.right + gap;
  const left = right + size.width <= view.width - 8 ? right : Math.max(8, card.left - gap - size.width);
  const top = Math.max(8, Math.min(card.top - 24, view.height - size.height - 8));
  return { left, top };
}
