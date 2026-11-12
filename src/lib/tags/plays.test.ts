import { describe, expect, it } from "vitest";
import { NO_PLAYS, cleanText, isAutomatic, playsTags, playsToSave, readPlays, steerThemes } from "./plays";
import type { ThemeTag } from "./themes";

const theme = (slug: string, score: number, label = slug): ThemeTag => ({
  key: `o:${slug}`,
  kind: "o",
  slug,
  label,
  size: 100,
  count: 5,
  pinned: false,
  score,
  depth: 1,
});

describe("readPlays", () => {
  it("reads a good value", () => {
    expect(readPlays({ tags: ["o:sacrifice-outlet", "a:dryad"], text: "  Drain  on every sac ", archetype: "aristocrats" })).toEqual({
      tags: ["o:sacrifice-outlet", "a:dryad"],
      text: "Drain on every sac",
      archetype: "aristocrats",
    });
  });
  it("drops junk, repeats and extras", () => {
    expect(readPlays({ tags: ["o:a", "o:a", "x:b", 3, "o:c", "o:d", "o:e"], text: "", archetype: "no spaces allowed" })).toEqual({
      tags: ["o:a", "o:c", "o:d"],
      text: null,
      archetype: null,
    });
    expect(readPlays(null)).toEqual(NO_PLAYS);
    expect(readPlays([])).toEqual(NO_PLAYS);
  });
  it("caps the text", () => {
    expect(cleanText("x".repeat(200))).toHaveLength(80);
    expect(cleanText("   ")).toBeNull();
  });
});

describe("saving", () => {
  it("stores null when everything is automatic", () => {
    expect(isAutomatic(NO_PLAYS)).toBe(true);
    expect(playsToSave(NO_PLAYS)).toBeNull();
    expect(playsToSave({ tags: [], text: "Go wide", archetype: null })).toEqual({ tags: [], text: "Go wide", archetype: null });
  });
});

describe("playsTags", () => {
  const themes = [theme("a", 9, "Alpha"), theme("b", 5, "Beta"), theme("c", 3, "Gamma"), theme("d", 1, "Delta")];
  it("shows the top 3 when nothing is picked", () => {
    expect(playsTags(NO_PLAYS, themes, (k) => k).map((t) => t.label)).toEqual(["Alpha", "Beta", "Gamma"]);
  });
  it("shows picked tags in their order, labeled even when they left the themes", () => {
    expect(playsTags({ ...NO_PLAYS, tags: ["o:d", "o:gone"] }, themes, (k) => `label of ${k}`).map((t) => t.label)).toEqual(["Delta", "label of o:gone"]);
  });
});

describe("steerThemes", () => {
  const all = [theme("a", 9), theme("b", 5), theme("c", 3), theme("d", 1)];
  it("is the plain top N without picks", () => {
    expect(steerThemes(all.slice(0, 2), all, []).map((t) => t.key)).toEqual(["o:a", "o:b"]);
  });
  it("doubles picked tags and brings in ones outside the top", () => {
    const out = steerThemes(all.slice(0, 2), all, ["o:b", "o:d", "o:missing"]);
    expect(out.map((t) => [t.key, t.score])).toEqual([
      ["o:a", 9],
      ["o:b", 10],
      ["o:d", 2],
    ]);
  });
  it("leaves the input untouched", () => {
    steerThemes(all.slice(0, 2), all, ["o:a"]);
    expect(all[0].score).toBe(9);
  });
});
