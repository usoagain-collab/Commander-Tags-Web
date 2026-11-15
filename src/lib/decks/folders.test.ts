import { describe, expect, it } from "vitest";
import { byFolderName, cleanFolderName, folderCounts, folderNameTaken, inFolder, NO_FOLDER, pickFolder } from "./folders";

const folders = [
  { id: "f1", name: "Casual" },
  { id: "f2", name: "cEDH" },
];
const decks = [
  { id: "a", folder_id: "f1" },
  { id: "b", folder_id: null },
  { id: "c", folder_id: "f1" },
];

describe("folders", () => {
  it("cleans names", () => {
    expect(cleanFolderName("  For   the\nkids ")).toBe("For the kids");
    expect(cleanFolderName("   ")).toBe("");
    expect(cleanFolderName("x".repeat(90))).toHaveLength(60);
  });

  it("spots a name in use, ignoring case, but not the folder's own", () => {
    expect(folderNameTaken(folders, "casual")).toBe(true);
    expect(folderNameTaken(folders, "Casual", "f1")).toBe(false);
    expect(folderNameTaken(folders, "Pauper")).toBe(false);
  });

  it("reads ?folder=", () => {
    expect(pickFolder("f2", folders)).toEqual({ id: "f2", noFolder: false });
    expect(pickFolder(NO_FOLDER, folders)).toEqual({ id: null, noFolder: true });
    expect(pickFolder("gone", folders)).toEqual({ id: null, noFolder: false });
    expect(pickFolder(undefined, folders)).toEqual({ id: null, noFolder: false });
  });

  it("filters and counts decks", () => {
    expect(inFolder(decks, { id: "f1", noFolder: false }).map((d) => d.id)).toEqual(["a", "c"]);
    expect(inFolder(decks, { id: null, noFolder: true }).map((d) => d.id)).toEqual(["b"]);
    expect(inFolder(decks, { id: null, noFolder: false })).toHaveLength(3);
    expect(folderCounts(decks)).toEqual({ f1: 2, none: 1 });
  });

  it("sorts by name without caring about case", () => {
    expect(byFolderName([{ id: "1", name: "zed" }, { id: "2", name: "Alpha" }]).map((f) => f.name)).toEqual(["Alpha", "zed"]);
  });
});
