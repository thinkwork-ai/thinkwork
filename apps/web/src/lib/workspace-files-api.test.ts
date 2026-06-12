import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));

import {
  createPrefixedWorkspaceClient,
  spacesWorkspaceFilesClient,
} from "./workspace-files-api";

function lastBody(): Record<string, unknown> {
  const [, init] = apiFetch.mock.calls.at(-1)!;
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiFetch.mockResolvedValue({ ok: true, files: [] });
});

describe("spacesWorkspaceFilesClient target scoping", () => {
  it("sends exactly the userId target for per-user edits (AE6)", async () => {
    await spacesWorkspaceFilesClient.putFile(
      { userId: "user-9" },
      "notes.md",
      "hello",
    );
    const body = lastBody();
    expect(body).toEqual({
      action: "put",
      userId: "user-9",
      path: "notes.md",
      content: "hello",
    });
    // Never the consolidated client's multi-source fan-out.
    expect(body.agentId).toBeUndefined();
    expect(body.spaceId).toBeUndefined();
  });

  it("sends exactly the spaceId target for per-Space lists", async () => {
    await spacesWorkspaceFilesClient.listFiles({ spaceId: "space-1" });
    expect(lastBody()).toEqual({ action: "list", spaceId: "space-1" });
  });

  it("sends exactly the agentId target for Main Agent reads", async () => {
    apiFetch.mockResolvedValueOnce({
      content: "x",
      source: "agent",
      sha256: "s",
    });
    await spacesWorkspaceFilesClient.getFile(
      { agentId: "agent-1" },
      "AGENTS.md",
    );
    expect(lastBody()).toEqual({
      action: "get",
      agentId: "agent-1",
      path: "AGENTS.md",
    });
  });
});

describe("createPrefixedWorkspaceClient", () => {
  const client = createPrefixedWorkspaceClient("agents/");

  it("lists only the subtree and strips the prefix", async () => {
    apiFetch.mockResolvedValueOnce({
      files: [
        { path: "AGENTS.md", source: "agent", sha256: "" },
        { path: "agents/research.md", source: "agent", sha256: "" },
        { path: "agents/review/notes.md", source: "agent", sha256: "" },
        { path: "skills/web/SKILL.md", source: "agent", sha256: "" },
      ],
    });
    const { files } = await client.listFiles({ agentId: "agent-1" });
    expect(files.map((f) => f.path)).toEqual([
      "research.md",
      "review/notes.md",
    ]);
  });

  it("re-prefixes reads and writes against the same single target", async () => {
    apiFetch.mockResolvedValueOnce({
      content: "x",
      source: "agent",
      sha256: "s",
    });
    await client.getFile({ agentId: "agent-1" }, "research.md");
    expect(lastBody()).toEqual({
      action: "get",
      agentId: "agent-1",
      path: "agents/research.md",
    });

    await client.putFile({ agentId: "agent-1" }, "research.md", "body");
    expect(lastBody()).toMatchObject({
      action: "put",
      agentId: "agent-1",
      path: "agents/research.md",
    });

    await client.deleteFile({ agentId: "agent-1" }, "research.md");
    expect(lastBody()).toEqual({
      action: "delete",
      agentId: "agent-1",
      path: "agents/research.md",
    });
  });

  it("re-prefixes renames and returns subtree-relative destinations", async () => {
    apiFetch.mockResolvedValueOnce({ destPath: "agents/renamed.md" });
    const result = await client.renamePath?.(
      { agentId: "agent-1" },
      "research.md",
      "renamed.md",
    );
    expect(lastBody()).toEqual({
      action: "rename",
      agentId: "agent-1",
      fromPath: "agents/research.md",
      toPath: "agents/renamed.md",
    });
    expect(result?.destPath).toBe("renamed.md");
  });

  it("normalizes a prefix without a trailing slash", async () => {
    const bare = createPrefixedWorkspaceClient("agents");
    await bare.putFile({ agentId: "agent-1" }, "x.md", "y");
    expect(lastBody()).toMatchObject({ path: "agents/x.md" });
  });
});
