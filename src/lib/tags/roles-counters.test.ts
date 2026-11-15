import { describe, expect, it } from "vitest";
import { resolveRoles, rolesOf, STANDARD_ROLES } from "./roles";
import { TagTree } from "./tree";

const tree = new TagTree({
  n: 1000,
  art_n: 1000,
  tags: [
    ["counterspell", "counterspell", 566, []], // 0
    ["counterspell-creature", "counterspell creature", 40, [0]], // 1
    ["removal", "removal", 0, []], // 2
  ],
} as unknown as ConstructorParameters<typeof TagTree>[0]);
const roles = resolveRoles(STANDARD_ROLES, tree);
const instant = { type_line: "Instant" };

describe("counterspells in the standard roles (David, Nov 15, 2026)", () => {
  it("counts a counterspell as Targeted removal and Protection", () => {
    expect(rolesOf(instant, ["counterspell"], roles)).toEqual(expect.arrayContaining(["removal", "protection"]));
  });

  it("leaves a creature-only counter out of Protection but keeps it as removal", () => {
    const r = rolesOf(instant, ["counterspell-creature"], roles);
    expect(r).toContain("removal");
    expect(r).not.toContain("protection");
  });
});
