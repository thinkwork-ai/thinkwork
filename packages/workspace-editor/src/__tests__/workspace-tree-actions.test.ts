import { describe, expect, it } from "vitest";
import {
  normalizeFolderPath,
  pathIsWithinFolder,
  filesForFolderDelete,
  topLevelFolders,
  validateSubAgentSlug,
  shouldEmitDetachToast,
  parentFolderOf,
  basenameOf,
  joinFolderPath,
  replacePathPrefix,
  validateInlineBasename,
} from "../lib/workspace-tree-actions.js";

describe("normalizeFolderPath", () => {
  it("strips leading and trailing slashes", () => {
    expect(normalizeFolderPath("/foo/bar/")).toBe("foo/bar");
  });

  it("collapses empty segments", () => {
    expect(normalizeFolderPath("foo//bar///baz")).toBe("foo/bar/baz");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeFolderPath("")).toBe("");
    expect(normalizeFolderPath("/")).toBe("");
  });

  it("leaves a clean path unchanged", () => {
    expect(normalizeFolderPath("notes/sub")).toBe("notes/sub");
  });
});

describe("pathIsWithinFolder", () => {
  it("returns true when path equals the folder", () => {
    expect(pathIsWithinFolder("notes", "notes")).toBe(true);
  });

  it("returns true when path is a child of the folder", () => {
    expect(pathIsWithinFolder("notes/readme.md", "notes")).toBe(true);
  });

  it("returns false when path is outside the folder", () => {
    expect(pathIsWithinFolder("other/file.md", "notes")).toBe(false);
  });

  it("returns false for prefix-only matches (no slash boundary)", () => {
    expect(pathIsWithinFolder("notes-extra/file.md", "notes")).toBe(false);
  });

  it("returns false when folder path is empty", () => {
    expect(pathIsWithinFolder("anything", "")).toBe(false);
  });
});

describe("filesForFolderDelete", () => {
  it("returns files within the folder, sorted", () => {
    const files = ["notes/b.md", "other/x.md", "notes/a.md"];
    expect(filesForFolderDelete(files, "notes")).toEqual([
      "notes/a.md",
      "notes/b.md",
    ]);
  });

  it("does not include the folder itself", () => {
    expect(filesForFolderDelete(["notes"], "notes")).toEqual([]);
  });

  it("returns empty array for empty folder path", () => {
    expect(filesForFolderDelete(["a.md", "b.md"], "")).toEqual([]);
  });
});

describe("topLevelFolders", () => {
  it("extracts unique top-level folder names", () => {
    const files = ["notes/a.md", "notes/b.md", "skills/s.md", "root.md"];
    const folders = topLevelFolders(files);
    expect(folders).toEqual(new Set(["notes", "skills"]));
  });

  it("excludes root-level files", () => {
    const folders = topLevelFolders(["file.md"]);
    expect(folders.size).toBe(0);
  });
});

describe("validateSubAgentSlug", () => {
  it("accepts a valid slug", () => {
    const result = validateSubAgentSlug("my-agent", []);
    expect(result).toEqual({ valid: true, slug: "my-agent" });
  });

  it("rejects empty input", () => {
    const result = validateSubAgentSlug("", []);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Enter a slug");
  });

  it("rejects slugs with invalid characters", () => {
    const result = validateSubAgentSlug("My_Agent!", []);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("lowercase");
  });

  it("rejects reserved slugs", () => {
    for (const reserved of ["memory", "skills", "workspaces"]) {
      const result = validateSubAgentSlug(reserved, []);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("reserved");
    }
  });

  it("rejects slugs that collide with existing top-level folders", () => {
    const result = validateSubAgentSlug("notes", ["notes/readme.md"]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("rejects slugs that collide with existing workspace sub-folders", () => {
    const result = validateSubAgentSlug("helper", [
      "workspaces/helper/GOAL.md",
    ]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("already exists");
  });

  it("trims whitespace before validation", () => {
    const result = validateSubAgentSlug("  agent-x  ", []);
    expect(result.valid).toBe(true);
    expect(result.slug).toBe("agent-x");
  });
});

describe("shouldEmitDetachToast", () => {
  it("returns null for single-file moves", () => {
    expect(
      shouldEmitDetachToast({ movedCount: 1, detachedPinnedCount: 3 }),
    ).toBeNull();
  });

  it("returns null when no pinned files were detached", () => {
    expect(
      shouldEmitDetachToast({ movedCount: 5, detachedPinnedCount: 0 }),
    ).toBeNull();
  });

  it("returns a toast string for bulk moves with detached pins", () => {
    const toast = shouldEmitDetachToast({
      movedCount: 3,
      detachedPinnedCount: 2,
    });
    expect(toast).toContain("Moved 3 files");
    expect(toast).toContain("2 files lost template inheritance");
  });

  it("uses singular 'file' for one detached pin", () => {
    const toast = shouldEmitDetachToast({
      movedCount: 2,
      detachedPinnedCount: 1,
    });
    expect(toast).toContain("1 file lost");
  });
});

describe("parentFolderOf", () => {
  it("returns parent folder for nested file", () => {
    expect(parentFolderOf("notes/sub/file.md")).toBe("notes/sub");
  });

  it("returns parent for single-level path", () => {
    expect(parentFolderOf("notes/file.md")).toBe("notes");
  });

  it("returns empty string for root-level path", () => {
    expect(parentFolderOf("file.md")).toBe("");
  });
});

describe("basenameOf", () => {
  it("returns filename from nested path", () => {
    expect(basenameOf("notes/sub/file.md")).toBe("file.md");
  });

  it("returns the name for a root-level file", () => {
    expect(basenameOf("file.md")).toBe("file.md");
  });

  it("strips trailing slashes before extracting", () => {
    expect(basenameOf("notes/sub/")).toBe("sub");
  });
});

describe("joinFolderPath", () => {
  it("joins parent and basename", () => {
    expect(joinFolderPath("notes", "file.md")).toBe("notes/file.md");
  });

  it("returns just the basename when parent is empty", () => {
    expect(joinFolderPath("", "file.md")).toBe("file.md");
  });

  it("normalizes the parent and trims the basename", () => {
    expect(joinFolderPath("/notes/", "  file.md  ")).toBe("notes/file.md");
  });
});

describe("replacePathPrefix", () => {
  it("replaces prefix for child paths", () => {
    expect(replacePathPrefix("old/sub/file.md", "old", "new")).toBe(
      "new/sub/file.md",
    );
  });

  it("replaces the path when it exactly matches the from path", () => {
    expect(replacePathPrefix("old", "old", "new")).toBe("new");
  });

  it("returns path unchanged when prefix does not match", () => {
    expect(replacePathPrefix("other/file.md", "old", "new")).toBe(
      "other/file.md",
    );
  });

  it("does not match partial segment prefixes", () => {
    expect(replacePathPrefix("older/file.md", "old", "new")).toBe(
      "older/file.md",
    );
  });
});

describe("validateInlineBasename", () => {
  it("accepts a normal filename", () => {
    expect(validateInlineBasename("readme.md")).toEqual({
      valid: true,
      basename: "readme.md",
    });
  });

  it("rejects empty input", () => {
    const result = validateInlineBasename("   ");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Enter a name");
  });

  it("rejects dot and double-dot", () => {
    expect(validateInlineBasename(".").valid).toBe(false);
    expect(validateInlineBasename("..").valid).toBe(false);
  });

  it("rejects paths with slashes", () => {
    expect(validateInlineBasename("foo/bar").valid).toBe(false);
    expect(validateInlineBasename("foo\\bar").valid).toBe(false);
  });

  it("trims whitespace", () => {
    const result = validateInlineBasename("  readme.md  ");
    expect(result.valid).toBe(true);
    expect(result.basename).toBe("readme.md");
  });
});
