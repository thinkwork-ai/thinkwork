import { describe, expect, it } from "vitest";

import type { WorkspaceProvider } from "../src/workspace-provider.js";

/**
 * In-memory stub backed by a Map — proves a host can satisfy read/list/sync with
 * no concrete S3 client (the inert-substitutability scenario for U3).
 */
function makeStub(files: Record<string, string>): WorkspaceProvider {
  const store = new Map(Object.entries(files));
  return {
    read: async (path) => store.get(path) ?? null,
    list: async (prefix) => {
      const paths = [...store.keys()];
      return prefix ? paths.filter((p) => p.startsWith(prefix)) : paths;
    },
    sync: async (prefix) => {
      const synced = prefix
        ? [...store.keys()].filter((p) => p.startsWith(prefix))
        : [...store.keys()];
      return { fileCount: synced.length, prefix: prefix ?? "" };
    },
  };
}

describe("WorkspaceProvider contract", () => {
  const provider = makeStub({
    "AGENTS.md": "# agents",
    "skills/foo/CONTEXT.md": "ctx",
    "skills/bar/CONTEXT.md": "ctx2",
  });

  it("reads an existing workspace-relative file", async () => {
    await expect(provider.read("AGENTS.md")).resolves.toBe("# agents");
  });

  it("returns null for a missing file rather than throwing", async () => {
    await expect(provider.read("nope.md")).resolves.toBeNull();
  });

  it("lists all paths when no prefix is given", async () => {
    await expect(provider.list()).resolves.toHaveLength(3);
  });

  it("filters listed paths by prefix", async () => {
    await expect(provider.list("skills/")).resolves.toEqual([
      "skills/foo/CONTEXT.md",
      "skills/bar/CONTEXT.md",
    ]);
  });

  it("syncs the whole workspace and reports the file count", async () => {
    await expect(provider.sync()).resolves.toEqual({
      fileCount: 3,
      prefix: "",
    });
  });

  it("syncs a subtree under a prefix", async () => {
    await expect(provider.sync("skills/")).resolves.toEqual({
      fileCount: 2,
      prefix: "skills/",
    });
  });
});
