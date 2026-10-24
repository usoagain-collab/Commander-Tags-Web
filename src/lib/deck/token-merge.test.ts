import { describe, expect, it } from "vitest";
import { mergeTokens } from "./token-merge";

const t = (token_id: string, name: string, type_line: string, made_by: string[]) => ({ token_id, name, type_line, made_by });

describe("mergeTokens", () => {
  it("merges same-named non-creature tokens and keeps the most-made printing", () => {
    const out = mergeTokens([
      t("a", "Treasure", "Token Artifact — Treasure", ["x"]),
      t("b", "Treasure", "Token Artifact — Treasure", ["y", "z"]),
      t("c", "Food", "Token Artifact — Food", ["x"]),
    ]);
    expect(out.map((o) => [o.token_id, o.name, o.made_by.sort()])).toEqual([
      ["c", "Food", ["x"]],
      ["b", "Treasure", ["x", "y", "z"]],
    ]);
  });

  it("keeps creature tokens apart even with the same name", () => {
    const out = mergeTokens([
      t("a", "Goblin", "Token Creature — Goblin", ["x"]),
      t("b", "Goblin", "Token Creature — Goblin", ["y"]),
    ]);
    expect(out).toHaveLength(2);
  });
});
