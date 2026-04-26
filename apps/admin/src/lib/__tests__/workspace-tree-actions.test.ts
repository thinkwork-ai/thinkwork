import { describe, expect, it } from "vitest";
import {
  filesForFolderDelete,
  normalizeFolderPath,
  pathIsWithinFolder,
  topLevelFolders,
  validateSubAgentSlug,
} from "../workspace-tree-actions";

describe("workspace tree actions", () => {
  it("normalizes folder paths", () => {
    expect(normalizeFolderPath("/skills/e2e-local-skill/")).toBe(
      "skills/e2e-local-skill",
    );
    expect(normalizeFolderPath("skills//foo///references/")).toBe(
      "skills/foo/references",
    );
  });

  it("matches paths inside a folder on segment boundaries", () => {
    expect(pathIsWithinFolder("skills/foo/SKILL.md", "skills/foo")).toBe(true);
    expect(
      pathIsWithinFolder("skills/foo/references/guide.md", "skills/foo/"),
    ).toBe(true);
    expect(pathIsWithinFolder("skills/foobar/SKILL.md", "skills/foo")).toBe(
      false,
    );
    expect(pathIsWithinFolder("skills/foo-bar/SKILL.md", "skills/foo")).toBe(
      false,
    );
  });

  it("returns concrete files for folder deletion", () => {
    expect(
      filesForFolderDelete(
        [
          "skills/foobar/SKILL.md",
          "skills/foo/references/guide.md",
          "AGENTS.md",
          "skills/foo/SKILL.md",
        ],
        "skills/foo",
      ),
    ).toEqual(["skills/foo/references/guide.md", "skills/foo/SKILL.md"]);
  });

  it("extracts top-level folders from workspace files", () => {
    expect(
      Array.from(
        topLevelFolders([
          "AGENTS.md",
          "expenses/CONTEXT.md",
          "expenses/escalation/GUARDRAILS.md",
          "support/CONTEXT.md",
        ]),
      ).sort(),
    ).toEqual(["expenses", "support"]);
  });

  it("validates sub-agent slugs before create", () => {
    expect(validateSubAgentSlug("support", [])).toEqual({
      valid: true,
      slug: "support",
    });
    expect(validateSubAgentSlug("memory", []).error).toBe(
      "`memory` is a reserved folder name.",
    );
    expect(validateSubAgentSlug("Sales", []).error).toMatch(/lowercase letter/);
    expect(
      validateSubAgentSlug("expenses", ["expenses/CONTEXT.md"]).error,
    ).toBe("A folder named `expenses` already exists at this agent's root.");
  });
});
