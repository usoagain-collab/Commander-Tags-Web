/** Layout choices saved in profiles.tag_view: the left column's dragged width and the card preview's mode. */

export const RAIL_MIN = 130;
export const RAIL_MAX = 1000;
export const RAIL_DEFAULT = 280;
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

export type PreviewMode = "float" | "docked" | "off";

export const readPreviewMode = (prefs: Record<string, unknown>): PreviewMode =>
  prefs.previewMode === "docked" || prefs.previewMode === "off" ? prefs.previewMode : "float";
