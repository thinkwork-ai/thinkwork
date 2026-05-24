import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

import {
  type ImportBundleStorage,
  importFolderBundle,
} from "../lib/folder-bundle-importer.js";

async function zipBody(entries: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [path, text] of Object.entries(entries)) zip.file(path, text);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.toString("base64");
}

function fakeStorage(existing: Record<string, string> = {}) {
  const files = new Map(Object.entries(existing));
  const writes: Array<{ path: string; content: string }> = [];
  const storage: ImportBundleStorage = {
    async getText(path) {
      return files.get(path) ?? null;
    },
    async putText(path, content) {
      writes.push({ path, content });
      files.set(path, content);
    },
    async deleteText(path) {
      files.delete(path);
    },
    async listPaths() {
      return Array.from(files.keys());
    },
  };
  return { storage, files, writes };
}

describe("importFolderBundle", () => {
  it("imports a Claude agent zip into workspace paths and adds a routing row", async () => {
    const { storage, files } = fakeStorage({
      "AGENTS.md": `# AGENTS.md

## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
`,
    });
    const body = await zipBody({
      ".claude/agents/expenses/CONTEXT.md": "# Expenses",
      ".claude/agents/expenses/NOTES.md": "notes",
    });

    const result = await importFolderBundle(
      { source: "zip", body },
      {
        agentId: "00000000-0000-0000-0000-000000000001",
        storage,
        lease: fakeLease(),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.importedPaths).toEqual([
      "workspaces/expenses/CONTEXT.md",
      "workspaces/expenses/NOTES.md",
    ]);
    expect(files.get("workspaces/expenses/CONTEXT.md")).toBe("# Expenses");
    expect(files.get("AGENTS.md")).toContain(
      "| Specialist for expenses | workspaces/expenses/ | workspaces/expenses/CONTEXT.md |  |",
    );
  });

  it("rejects a reserved root file before writing anything", async () => {
    const { storage, writes } = fakeStorage();
    const body = await zipBody({
      "USER.md": "prompt injection",
      ".claude/agents/expenses/CONTEXT.md": "# Expenses",
    });

    const result = await importFolderBundle(
      { source: "zip", body },
      {
        agentId: "00000000-0000-0000-0000-000000000001",
        storage,
        lease: fakeLease(),
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("ReservedRootFile");
    expect(writes).toEqual([]);
  });

  it("rejects a bundle that collides with an existing sub-agent folder", async () => {
    const { storage } = fakeStorage({
      "workspaces/expenses/CONTEXT.md": "old",
    });
    const body = await zipBody({
      ".claude/agents/expenses/CONTEXT.md": "new",
    });

    const result = await importFolderBundle(
      { source: "zip", body },
      {
        agentId: "00000000-0000-0000-0000-000000000001",
        storage,
        lease: fakeLease(),
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("ExistingSubAgentCollision");
  });

  it("rejects a vendor agent bundle that collides with an existing legacy-flat sub-agent", async () => {
    const { storage } = fakeStorage({
      "expenses/CONTEXT.md": "old",
    });
    const body = await zipBody({
      ".claude/agents/expenses/CONTEXT.md": "new",
    });

    const result = await importFolderBundle(
      { source: "zip", body },
      {
        agentId: "00000000-0000-0000-0000-000000000001",
        storage,
        lease: fakeLease(),
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("ExistingSubAgentCollision");
    expect(result.details).toMatchObject({ folder: "workspaces/expenses" });
  });

  it("rejects two vendor-prefixed paths that normalize to the same target", async () => {
    const { storage } = fakeStorage();
    const body = await zipBody({
      ".claude/agents/expenses/CONTEXT.md": "claude",
      ".codex/agents/expenses/CONTEXT.md": "codex",
    });

    const result = await importFolderBundle(
      { source: "zip", body },
      {
        agentId: "00000000-0000-0000-0000-000000000001",
        storage,
        lease: fakeLease(),
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("PathCollision");
  });

  it("lets a vendor-prefixed path win over the same plain path", async () => {
    const { storage, files } = fakeStorage();
    const body = await zipBody({
      "workspaces/expenses/CONTEXT.md": "plain",
      ".claude/agents/expenses/CONTEXT.md": "vendor",
    });

    const result = await importFolderBundle(
      { source: "zip", body },
      {
        agentId: "00000000-0000-0000-0000-000000000001",
        storage,
        lease: fakeLease(),
      },
    );

    expect(result.ok).toBe(true);
    expect(files.get("workspaces/expenses/CONTEXT.md")).toBe("vendor");
  });

  it("imports nested workspace folders under a workspace parent", async () => {
    const { storage, files } = fakeStorage();
    const body = await zipBody({
      "workspaces/parent/CONTEXT.md": "# Parent",
      "workspaces/parent/workspaces/child/CONTEXT.md": "# Child",
    });

    const result = await importFolderBundle(
      { source: "zip", body },
      {
        agentId: "00000000-0000-0000-0000-000000000001",
        storage,
        lease: fakeLease(),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.importedPaths).toEqual([
      "workspaces/parent/CONTEXT.md",
      "workspaces/parent/workspaces/child/CONTEXT.md",
    ]);
    expect(files.get("workspaces/parent/workspaces/child/CONTEXT.md")).toBe(
      "# Child",
    );
  });

  it.each([
    "workspaces/.hidden/CONTEXT.md",
    "workspaces/Foo/CONTEXT.md",
    "workspaces/foo.bar/CONTEXT.md",
    "workspaces/workspaces/CONTEXT.md",
  ])("rejects invalid workspace slug paths: %s", async (path) => {
    const { storage, writes } = fakeStorage();
    const body = await zipBody({ [path]: "# Invalid" });

    const result = await importFolderBundle(
      { source: "zip", body },
      {
        agentId: "00000000-0000-0000-0000-000000000001",
        storage,
        lease: fakeLease(),
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("InvalidWorkspaceSlug");
    expect(writes).toEqual([]);
  });

  it("rolls back files already written when a later write fails", async () => {
    const { storage, files } = fakeStorage();
    const realPut = storage.putText;
    let calls = 0;
    storage.putText = async (path, content) => {
      calls++;
      if (calls === 2) throw new Error("S3 write failed");
      await realPut(path, content);
    };
    const body = await zipBody({
      ".claude/agents/expenses/CONTEXT.md": "context",
      ".claude/agents/expenses/NOTES.md": "notes",
    });

    await expect(
      importFolderBundle(
        { source: "zip", body },
        {
          agentId: "00000000-0000-0000-0000-000000000001",
          storage,
          lease: fakeLease(),
        },
      ),
    ).rejects.toThrow("S3 write failed");
    expect(files.has("workspaces/expenses/CONTEXT.md")).toBe(false);
  });

  it("imports a git ref using the injectable fetcher and discards PAT after fetch", async () => {
    const { storage, files } = fakeStorage();
    const fetchGitRef = vi.fn(async () => ({
      ok: true as const,
      files: { ".claude/agents/support/CONTEXT.md": "# Support" },
    }));

    const result = await importFolderBundle(
      {
        source: "git",
        url: "https://github.com/acme/fog",
        ref: "main",
        pat: "secret",
      },
      {
        agentId: "00000000-0000-0000-0000-000000000001",
        storage,
        lease: fakeLease(),
        fetchGitRef,
      },
    );

    expect(result.ok).toBe(true);
    expect(fetchGitRef).toHaveBeenCalledWith({
      url: "https://github.com/acme/fog",
      ref: "main",
      pat: "secret",
    });
    expect(files.get("workspaces/support/CONTEXT.md")).toBe("# Support");
  });
});

function fakeLease() {
  return {
    async acquireExclusive(agentId: string) {
      return { agentId, leaseId: "lease-1", leaseKind: "exclusive" as const };
    },
    async release() {},
  };
}
