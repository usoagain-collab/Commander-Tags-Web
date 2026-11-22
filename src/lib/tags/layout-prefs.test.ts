import { describe, expect, it } from "vitest";
import { clampRail, RAIL_COLLAPSED, RAIL_DEFAULT, RAIL_MAX, RAIL_MIN, railStage, railWidthOf, readPreviewMode, besidePosition } from "./layout-prefs";

describe("left column width", () => {
  it("keeps the old collapsed flag working", () => {
    expect(railWidthOf({})).toBe(RAIL_DEFAULT);
    expect(railWidthOf({ leftCollapsed: true })).toBe(RAIL_COLLAPSED);
    expect(railWidthOf({ leftCollapsed: true, railWidth: 400 })).toBe(400);
  });

  it("stays within its limits", () => {
    expect(clampRail(1)).toBe(RAIL_MIN);
    expect(clampRail(5000)).toBe(RAIL_MAX);
    expect(railWidthOf({ railWidth: "wide" })).toBe(RAIL_DEFAULT);
  });

  it("changes stage as it narrows", () => {
    expect(railStage(600)).toBe("full");
    expect(railStage(RAIL_DEFAULT)).toBe("rail");
    expect(railStage(RAIL_COLLAPSED)).toBe("rail");
    expect(railStage(RAIL_MIN)).toBe("compact");
  });
});

describe("preview mode", () => {
  it("defaults to floating", () => {
    expect(readPreviewMode({})).toBe("float");
    expect(readPreviewMode({ previewMode: "nonsense" })).toBe("float");
    expect(readPreviewMode({ previewMode: "docked" })).toBe("docked");
    expect(readPreviewMode({ previewMode: "off" })).toBe("off");
    expect(readPreviewMode({ previewMode: "beside" })).toBe("beside");
  });

  it("puts the beside preview right of the card, or left when it won't fit, inside the window", () => {
    const view = { width: 1600, height: 900 };
    expect(besidePosition({ left: 100, right: 250, top: 300 }, view)).toEqual({ left: 262, top: 276 });
    expect(besidePosition({ left: 1300, right: 1450, top: 300 }, view)).toEqual({ left: 1018, top: 276 });
    expect(besidePosition({ left: 100, right: 250, top: 800 }, view).top).toBe(900 - 520 - 8);
    expect(besidePosition({ left: 100, right: 250, top: 0 }, view).top).toBe(8);
  });
});
