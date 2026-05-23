import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveWorkspaceFile } from "../workspace-files-api";

// Mock @/lib/auth so we don't need a real Cognito token in unit tests.
vi.mock("@/lib/auth", () => ({
  getIdToken: vi.fn().mockResolvedValue("fake-id-token"),
}));

describe("moveWorkspaceFile (client wrapper for /api/workspaces/files)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockOk(body: Record<string, unknown>) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, ...body }),
    });
  }

  it("posts action=move with the target + fromPath + toFolder", async () => {
    mockOk({ destPath: "memory/notes.md", movedCount: 1, detachedPinnedCount: 0 });

    const result = await moveWorkspaceFile(
      { agentId: "agent-abc" },
      "notes.md",
      "memory",
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      action: "move",
      agentId: "agent-abc",
      fromPath: "notes.md",
      toFolder: "memory",
    });
    expect(result).toMatchObject({
      destPath: "memory/notes.md",
      movedCount: 1,
      detachedPinnedCount: 0,
    });
  });

  it("supports empty toFolder for moving to the workspace root", async () => {
    mockOk({ destPath: "log.md", movedCount: 1, detachedPinnedCount: 0 });

    await moveWorkspaceFile(
      { spaceId: "space-eng" },
      "events/log.md",
      "",
    );

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.toFolder).toBe("");
    expect(body.spaceId).toBe("space-eng");
  });

  it("throws with the server error string on a non-2xx response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ ok: false, error: "Source and destination are identical" }),
    });

    await expect(
      moveWorkspaceFile({ agentId: "agent-abc" }, "notes.md", ""),
    ).rejects.toThrow(/Source and destination/);
  });
});
