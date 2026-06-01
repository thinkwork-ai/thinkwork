import { describe, expect, it } from "vitest";
import { workspaceToolsExtension } from "../extensions/workspace-tools-extension";
import { loadExtensions } from "../extensions/load-extensions";
import {
  MemoryWorkspaceCacheStorage,
  WorkspaceCache,
  createWorkspaceCachePartition,
  type WorkspaceCacheSource,
} from "../workspace-cache";
import type { WorkspaceTarget } from "@/lib/workspace-api";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const partition = createWorkspaceCachePartition({
  stage: "dev",
  tenantId: "tenant-1",
  agentId: "agent-1",
  userId: "user-1",
});

class FakeSource implements WorkspaceCacheSource {
  async listFiles(_target: WorkspaceTarget) {
    return {
      files: [
        {
          path: "USER.md",
          source: "user" as const,
          sha256: "user",
          overridden: false,
          content: "Name: Eric\nRole: Builder",
        },
        {
          path: "docs/notes.md",
          source: "agent" as const,
          sha256: "notes",
          overridden: false,
          content: "Mobile Pi should rely on bash and workspace tools.",
        },
      ],
    };
  }
}

async function loadWorkspaceTools() {
  const cache = new WorkspaceCache(
    new MemoryWorkspaceCacheStorage(),
    new FakeSource(),
  );
  const loaded = await loadExtensions(
    [
      workspaceToolsExtension({
        cache,
        partition,
        targets: [{ userId: "user-1" }],
      }),
    ],
    { logger: silentLogger },
  );
  return loaded.tools;
}

describe("workspace tools", () => {
  it("registers read, grep, find, and ls over the workspace cache", async () => {
    const tools = await loadWorkspaceTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "read",
      "grep",
      "find",
      "ls",
    ]);
    await expect(
      tools
        .find((tool) => tool.name === "read")
        ?.execute({ path: "User/USER.md" }, {}),
    ).resolves.toMatchObject({ content: "Name: Eric\nRole: Builder" });
    await expect(
      tools
        .find((tool) => tool.name === "grep")
        ?.execute({ pattern: "bash" }, {}),
    ).resolves.toMatchObject({
      content:
        "docs/notes.md:1: Mobile Pi should rely on bash and workspace tools.",
    });
    await expect(
      tools
        .find((tool) => tool.name === "find")
        ?.execute({ query: "notes" }, {}),
    ).resolves.toMatchObject({ content: "docs/notes.md" });
    await expect(
      tools.find((tool) => tool.name === "ls")?.execute({}, {}),
    ).resolves.toMatchObject({ content: "docs/\nUser/" });
  });

  it("rejects path traversal from read-only tools", async () => {
    const tools = await loadWorkspaceTools();
    await expect(
      tools
        .find((tool) => tool.name === "read")
        ?.execute({ path: "../USER.md" }, {}),
    ).resolves.toMatchObject({
      isError: true,
      content: "workspace path is unsafe",
    });
  });
});
