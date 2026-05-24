import { describe, expect, it } from "vitest";
import {
  basenameOf,
  filesForFolderDelete,
  joinFolderPath,
  normalizeFolderPath,
  parentFolderOf,
  pathIsWithinFolder,
  replacePathPrefix,
  shouldEmitDetachToast,
  topLevelFolders,
  validateInlineBasename,
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

  describe("shouldEmitDetachToast", () => {
    it("fires only for folder moves that detached pinned files (AE5)", () => {
      expect(
        shouldEmitDetachToast({ movedCount: 12, detachedPinnedCount: 3 }),
      ).toBe("Moved 12 files. 3 files lost template inheritance.");
    });

    it("does not fire for single-file pinned moves (R20 carve-out)", () => {
      expect(
        shouldEmitDetachToast({ movedCount: 1, detachedPinnedCount: 1 }),
      ).toBeNull();
    });

    it("does not fire when no pinned files were detached", () => {
      expect(
        shouldEmitDetachToast({ movedCount: 20, detachedPinnedCount: 0 }),
      ).toBeNull();
    });

    it("uses singular wording when exactly one pinned file detached", () => {
      expect(
        shouldEmitDetachToast({ movedCount: 5, detachedPinnedCount: 1 }),
      ).toBe("Moved 5 files. 1 file lost template inheritance.");
    });
  });

  it("derives parent folder paths", () => {
    expect(parentFolderOf("notes.md")).toBe("");
    expect(parentFolderOf("memory/notes.md")).toBe("memory");
    expect(parentFolderOf("a/b/c.md")).toBe("a/b");
  });

  it("derives basenames and joins inline names to parent folders", () => {
    expect(basenameOf("notes.md")).toBe("notes.md");
    expect(basenameOf("memory/notes.md")).toBe("notes.md");
    expect(joinFolderPath("", "notes.md")).toBe("notes.md");
    expect(joinFolderPath("memory/", "notes.md")).toBe("memory/notes.md");
  });

  it("replaces renamed path prefixes on segment boundaries", () => {
    expect(replacePathPrefix("notes.md", "notes.md", "ideas.md")).toBe(
      "ideas.md",
    );
    expect(replacePathPrefix("folder/a.md", "folder", "renamed")).toBe(
      "renamed/a.md",
    );
    expect(replacePathPrefix("folderish/a.md", "folder", "renamed")).toBe(
      "folderish/a.md",
    );
  });

  it("validates inline basenames", () => {
    expect(validateInlineBasename("notes.md")).toEqual({
      valid: true,
      basename: "notes.md",
    });
    expect(validateInlineBasename("").error).toBe("Enter a name.");
    expect(validateInlineBasename(".").error).toBe("Choose a different name.");
    expect(validateInlineBasename("nested/path.md").error).toBe(
      "Use a name, not a path.",
    );
    expect(validateInlineBasename("nested\\path.md").error).toBe(
      "Use a name, not a path.",
    );
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
