import { describe, expect, it } from "vitest";
import {
  filesForFolderDelete,
  normalizeFolderPath,
  pathIsWithinFolder,
} from "../workspace-tree-actions";

describe("workspace tree actions", () => {
  it("normalizes folder paths", () => {
    expect(normalizeFolderPath("/skills/e2e-local-skill/")).toBe("skills/e2e-local-skill");
    expect(normalizeFolderPath("skills//foo///references/")).toBe("skills/foo/references");
  });

  it("matches paths inside a folder on segment boundaries", () => {
    expect(pathIsWithinFolder("skills/foo/SKILL.md", "skills/foo")).toBe(true);
    expect(pathIsWithinFolder("skills/foo/references/guide.md", "skills/foo/")).toBe(true);
    expect(pathIsWithinFolder("skills/foobar/SKILL.md", "skills/foo")).toBe(false);
    expect(pathIsWithinFolder("skills/foo-bar/SKILL.md", "skills/foo")).toBe(false);
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
});
