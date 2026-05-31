import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectQueue } = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
        }),
      }),
    }),
  }),
}));

describe("reconcile context access gate", () => {
  beforeEach(() => {
    selectQueue.length = 0;
  });

  it("rejects reconcile after private Space access is revoked mid-turn", async () => {
    const { reconcileChangedFiles } = await import("./reconcile.js");
    const objectStore = {
      getText: vi.fn(async () => {
        throw new Error("hydrate manifest should not be read");
      }),
      putText: vi.fn(),
      deleteObject: vi.fn(),
    };

    selectQueue.push([
      {
        id: "thread-1",
        tenantId: "tenant-1",
        agentId: "agent-1",
        spaceId: "space-1",
        userId: "user-1",
        workspaceFolderName: "thread-1",
      },
    ]);
    selectQueue.push([{ slug: "acme" }]);
    selectQueue.push([
      {
        id: "space-1",
        slug: "board-pack",
        workspaceFolderName: "board-pack",
        accessMode: "private",
        status: "active",
      },
    ]);
    selectQueue.push([]);

    await expect(
      reconcileChangedFiles({
        tenantId: "tenant-1",
        agentId: "agent-1",
        threadId: "thread-1",
        threadTurnId: "turn-1",
        bucket: "workspace-bucket",
        changedFiles: [
          {
            path: "docs/brief.md",
            op: "modify",
            content: "# Brief",
            base_etag: '"old"',
          },
        ],
        objectStore,
      }),
    ).rejects.toThrow("Thread user is not a member of the private Space.");
    expect(objectStore.getText).not.toHaveBeenCalled();
    expect(objectStore.putText).not.toHaveBeenCalled();
  });
});
