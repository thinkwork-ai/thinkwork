import { describe, expect, it } from "vitest";
import { loadExtensions } from "../load-extensions";
import {
  MemoryBashSnapshotStorage,
  localBashExtension,
  resetLocalBashSandboxesForTests,
} from "../local-bash-extension";
import {
  MemoryWorkspaceCacheStorage,
  WorkspaceCache,
  createWorkspaceCachePartition,
  type WorkspaceCacheSource,
} from "../../workspace-cache";
import type { WorkspaceTarget } from "@/lib/workspace-api";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("localBashExtension", () => {
  it("registers a local bash tool and executes commands in the sandbox", async () => {
    const loaded = await loadExtensions(
      [
        localBashExtension({
          sessionId: "test-bash-basic",
          snapshotStorage: new MemoryBashSnapshotStorage(),
        }),
      ],
      { logger: silentLogger },
    );
    const bash = loaded.tools.find((tool) => tool.name === "bash");

    expect(bash).toBeDefined();
    const result = await bash!.execute(
      { command: "printf MOBILE-PI-BASH-SMOKE-OK" },
      {},
    );

    expect(result).toEqual({
      content: "MOBILE-PI-BASH-SMOKE-OK",
      isError: false,
    });
  });

  it("keeps an in-memory filesystem per thread session", async () => {
    const loaded = await loadExtensions(
      [
        localBashExtension({
          sessionId: "test-bash-fs",
          snapshotStorage: new MemoryBashSnapshotStorage(),
        }),
      ],
      { logger: silentLogger },
    );
    const bash = loaded.tools.find((tool) => tool.name === "bash")!;

    await bash.execute({ command: "printf saved > note.txt" }, {});
    const result = await bash.execute({ command: "cat note.txt" }, {});

    expect(result.content).toBe("saved");
    expect(result.isError).toBe(false);
  });

  it("hydrates /workspace as the merged agent root with Space beside it", async () => {
    const workspace = workspaceFixture();
    const loaded = await loadExtensions(
      [
        localBashExtension({
          sessionId: "test-bash-workspace-cache",
          workspace,
          snapshotStorage: new MemoryBashSnapshotStorage(),
        }),
      ],
      { logger: silentLogger },
    );
    const bash = loaded.tools.find((tool) => tool.name === "bash")!;

    const result = await bash.execute(
      {
        command:
          "pwd; find . -maxdepth 1 -mindepth 1 -type d -print | sort; cat AGENTS.md; cat USER.md; cat Space/CONTEXT.md",
      },
      {},
    );

    expect(result.content).toContain("Name: Eric");
    expect(result.content).toContain("# Agent");
    expect(result.content).toContain("# Space");
    expect(result.content).toContain("/workspace");
    expect(result.content).toContain("./Space");
    expect(result.content).not.toContain("./Agent");
    expect(result.content).not.toContain("./Spaces");
    expect(result.content).not.toContain("./User");
    expect(result.isError).toBe(false);
  });

  it("persists /workspace files for the same thread across extension reloads", async () => {
    const storage = new MemoryBashSnapshotStorage();
    const sessionId = "test-bash-durable-thread";
    const first = await loadExtensions(
      [localBashExtension({ sessionId, snapshotStorage: storage })],
      { logger: silentLogger },
    );
    await first.tools
      .find((tool) => tool.name === "bash")!
      .execute({ command: "printf saved > note.txt" }, {});

    resetLocalBashSandboxesForTests();

    const second = await loadExtensions(
      [localBashExtension({ sessionId, snapshotStorage: storage })],
      { logger: silentLogger },
    );
    const result = await second.tools
      .find((tool) => tool.name === "bash")!
      .execute({ command: "cat note.txt" }, {});

    expect(result.content).toBe("saved");
    expect(result.isError).toBe(false);
  });

  it("does not resurrect deleted cached workspace files after snapshotting", async () => {
    const storage = new MemoryBashSnapshotStorage();
    const sessionId = "test-bash-cache-delete";
    const first = await loadExtensions(
      [
        localBashExtension({
          sessionId,
          workspace: workspaceFixture(),
          snapshotStorage: storage,
        }),
      ],
      { logger: silentLogger },
    );
    const bash = first.tools.find((tool) => tool.name === "bash")!;

    await bash.execute({ command: "cat USER.md" }, {});
    await bash.execute({ command: "rm USER.md" }, {});

    resetLocalBashSandboxesForTests();

    const second = await loadExtensions(
      [
        localBashExtension({
          sessionId,
          workspace: workspaceFixture(),
          snapshotStorage: storage,
        }),
      ],
      { logger: silentLogger },
    );
    const result = await second.tools
      .find((tool) => tool.name === "bash")!
      .execute({ command: "cat USER.md" }, {});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("exitCode");
  });

  it("does not share durable /workspace files across threads", async () => {
    const storage = new MemoryBashSnapshotStorage();
    const first = await loadExtensions(
      [
        localBashExtension({
          sessionId: "test-bash-thread-a",
          snapshotStorage: storage,
        }),
      ],
      { logger: silentLogger },
    );
    await first.tools
      .find((tool) => tool.name === "bash")!
      .execute({ command: "printf private > note.txt" }, {});

    resetLocalBashSandboxesForTests();

    const second = await loadExtensions(
      [
        localBashExtension({
          sessionId: "test-bash-thread-b",
          snapshotStorage: storage,
        }),
      ],
      { logger: silentLogger },
    );
    const result = await second.tools
      .find((tool) => tool.name === "bash")!
      .execute({ command: "cat note.txt" }, {});

    expect(result.isError).toBe(true);
    expect(result.content).toContain("exitCode");
  });

  it("keys durable files from the loop-provided session id", async () => {
    const storage = new MemoryBashSnapshotStorage();
    const first = await loadExtensions(
      [localBashExtension({ snapshotStorage: storage })],
      { logger: silentLogger },
    );
    await first.tools
      .find((tool) => tool.name === "bash")!
      .execute(
        { command: "printf from-context > ctx.txt" },
        { sessionId: "test-bash-context-session" },
      );

    resetLocalBashSandboxesForTests();

    const second = await loadExtensions(
      [localBashExtension({ snapshotStorage: storage })],
      { logger: silentLogger },
    );
    const result = await second.tools
      .find((tool) => tool.name === "bash")!
      .execute(
        { command: "cat ctx.txt" },
        { sessionId: "test-bash-context-session" },
      );

    expect(result.content).toBe("from-context");
    expect(result.isError).toBe(false);
  });

  it("marks non-zero exits as tool errors", async () => {
    const loaded = await loadExtensions(
      [
        localBashExtension({
          sessionId: "test-bash-failure",
          snapshotStorage: new MemoryBashSnapshotStorage(),
        }),
      ],
      { logger: silentLogger },
    );
    const bash = loaded.tools.find((tool) => tool.name === "bash")!;
    const result = await bash.execute(
      { command: 'printf "nope" >&2; exit 7' },
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("stderr:");
    expect(result.content).toContain("nope");
    expect(result.content).toContain("exitCode: 7");
  });

  it("composes prompt guidance for the local mobile sandbox", async () => {
    const loaded = await loadExtensions(
      [
        localBashExtension({
          sessionId: "test-bash-prompt",
          snapshotStorage: new MemoryBashSnapshotStorage(),
        }),
      ],
      { logger: silentLogger },
    );
    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
    });

    expect(composed.systemPrompt).toContain("local `bash` tool");
    expect(composed.systemPrompt).toContain("mobile app");
    expect(composed.systemPrompt).toContain("durable per-thread /workspace");
    expect(composed.systemPrompt).toContain(
      "Public internet access is enabled",
    );
    expect(composed.systemPrompt).toContain("private/loopback");
  });
});

function workspaceFixture() {
  const targets: readonly WorkspaceTarget[] = [
    { agentId: "agent-1" },
    { spaceId: "space-1", spaceFolderName: "general" },
    { userId: "user-1" },
  ];
  const source: WorkspaceCacheSource = {
    async listFiles(target) {
      if ("agentId" in target) {
        return {
          files: [
            {
              path: "workspace/AGENTS.md",
              content: "# Agent\n",
              source: "agent",
              sha256: "sha-agent",
              overridden: false,
            },
          ],
        };
      }
      if ("spaceId" in target) {
        return {
          files: [
            {
              path: "source/CONTEXT.md",
              content: "# Space\n",
              source: "space",
              sha256: "sha-space",
              overridden: false,
            },
          ],
        };
      }
      return {
        files: [
          {
            path: "USER.md",
            content: "Name: Eric\n",
            source: "user",
            sha256: "sha-user",
            overridden: false,
          },
        ],
      };
    },
  };
  return {
    cache: new WorkspaceCache(new MemoryWorkspaceCacheStorage(), source, {
      cacheTtlMs: 0,
    }),
    partition: createWorkspaceCachePartition({
      stage: "test",
      tenantId: "tenant-1",
      agentId: "agent-1",
      spaceId: "space-1",
      userId: "user-1",
    }),
    targets,
  };
}
