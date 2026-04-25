import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filesForFolderDelete,
  normalizeFolderPath,
  pathIsWithinFolder,
} from "../workspace-tree-actions";

describe("workspace tree actions", () => {
  it("normalizes folder paths", () => {
    assert.equal(normalizeFolderPath("/skills/e2e-local-skill/"), "skills/e2e-local-skill");
    assert.equal(normalizeFolderPath("skills//foo///references/"), "skills/foo/references");
  });

  it("matches paths inside a folder on segment boundaries", () => {
    assert.equal(pathIsWithinFolder("skills/foo/SKILL.md", "skills/foo"), true);
    assert.equal(pathIsWithinFolder("skills/foo/references/guide.md", "skills/foo/"), true);
    assert.equal(pathIsWithinFolder("skills/foobar/SKILL.md", "skills/foo"), false);
    assert.equal(pathIsWithinFolder("skills/foo-bar/SKILL.md", "skills/foo"), false);
  });

  it("returns concrete files for folder deletion", () => {
    assert.deepEqual(
      filesForFolderDelete(
        [
          "skills/foobar/SKILL.md",
          "skills/foo/references/guide.md",
          "AGENTS.md",
          "skills/foo/SKILL.md",
        ],
        "skills/foo",
      ),
      ["skills/foo/references/guide.md", "skills/foo/SKILL.md"],
    );
  });
});
