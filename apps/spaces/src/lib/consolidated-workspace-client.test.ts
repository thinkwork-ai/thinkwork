import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFileMeta } from "@thinkwork/workspace-editor";

const { listFiles, getFile, putFile, deleteFile, movePath, renamePath } =
  vi.hoisted(() => ({
    listFiles: vi.fn(),
    getFile: vi.fn(),
    putFile: vi.fn(),
    deleteFile: vi.fn(),
    movePath: vi.fn(),
    renamePath: vi.fn(),
  }));

vi.mock("@/lib/workspace-files-api", () => ({
  spacesWorkspaceFilesClient: {
    listFiles,
    getFile,
    putFile,
    deleteFile,
    movePath,
    renamePath,
  },
}));

import {
  createConsolidatedWorkspaceClient,
  type ConsolidatedTarget,
} from "./consolidated-workspace-client";

function meta(path: string): WorkspaceFileMeta {
  return { path, source: "agent", sha256: "" };
}

const target: ConsolidatedTarget = {
  agentId: "agent-1",
  spaces: [
    { id: "space-fin", name: "finance" },
    { id: "space-gen", name: "general" },
  ],
  userId: "user-1",
};

const client = createConsolidatedWorkspaceClient();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listFiles", () => {
  it("concatenates and prefixes files from all three sources", async () => {
    listFiles.mockImplementation((sub: Record<string, string>) => {
      if (sub.agentId) return Promise.resolve({ files: [meta("AGENTS.md")] });
      if (sub.spaceId === "space-fin")
        return Promise.resolve({ files: [meta("GOAL.md")] });
      if (sub.spaceId === "space-gen")
        return Promise.resolve({ files: [meta("README.md")] });
      if (sub.userId) return Promise.resolve({ files: [meta("USER.md")] });
      return Promise.resolve({ files: [] });
    });

    const { files } = await client.listFiles(target);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      "Agent/AGENTS.md",
      "Spaces/finance/GOAL.md",
      "Spaces/general/README.md",
      "User/USER.md",
    ]);
  });

  it("degrades to a partial tree when one source rejects", async () => {
    listFiles.mockImplementation((sub: Record<string, string>) => {
      if (sub.spaceId === "space-fin") return Promise.reject(new Error("403"));
      if (sub.agentId) return Promise.resolve({ files: [meta("AGENTS.md")] });
      return Promise.resolve({ files: [] });
    });

    const { files } = await client.listFiles(target);
    expect(files.map((f) => f.path)).toContain("Agent/AGENTS.md");
    expect(files.map((f) => f.path)).not.toContain("Spaces/finance/GOAL.md");
  });

  it("skips sources that are absent on the target", async () => {
    listFiles.mockResolvedValue({ files: [meta("X.md")] });
    await client.listFiles({ agentId: null, spaces: [], userId: "user-1" });
    expect(listFiles).toHaveBeenCalledTimes(1);
    expect(listFiles).toHaveBeenCalledWith({ userId: "user-1" });
  });
});

describe("routing", () => {
  it("routes an Agent path to the agent target with the prefix stripped", async () => {
    getFile.mockResolvedValue({ content: "x", source: "agent", sha256: "" });
    await client.getFile(target, "Agent/AGENTS.md");
    expect(getFile).toHaveBeenCalledWith({ agentId: "agent-1" }, "AGENTS.md");
  });

  it("resolves a Spaces path by space name to its id", async () => {
    getFile.mockResolvedValue({ content: "x", source: "space", sha256: "" });
    await client.getFile(target, "Spaces/finance/GOAL.md");
    expect(getFile).toHaveBeenCalledWith({ spaceId: "space-fin" }, "GOAL.md");
  });

  it("routes a User put to the user target", async () => {
    putFile.mockResolvedValue(undefined);
    await client.putFile(target, "User/USER.md", "hello");
    expect(putFile).toHaveBeenCalledWith(
      { userId: "user-1" },
      "USER.md",
      "hello",
    );
  });

  it("rejects an unknown root with a human-readable message", async () => {
    await expect(client.getFile(target, "Bogus/x.md")).rejects.toThrow(
      /under Agent, Spaces, or User/,
    );
    expect(getFile).not.toHaveBeenCalled();
  });

  it("rejects a root-level path (no source) without calling the API", async () => {
    await expect(client.putFile(target, "notes.md", "x")).rejects.toThrow(
      /under Agent, Spaces, or User/,
    );
    expect(putFile).not.toHaveBeenCalled();
  });

  it("routes a space whose name contains a slash via longest-prefix match", async () => {
    const slashTarget: ConsolidatedTarget = {
      agentId: null,
      spaces: [{ id: "s-q", name: "Q1/Q2 Planning" }],
      userId: null,
    };
    getFile.mockResolvedValue({ content: "x", source: "space", sha256: "" });
    await client.getFile(slashTarget, "Spaces/Q1/Q2 Planning/GOAL.md");
    expect(getFile).toHaveBeenCalledWith({ spaceId: "s-q" }, "GOAL.md");
  });

  it("disambiguates spaces where one name prefixes another", async () => {
    const overlap: ConsolidatedTarget = {
      agentId: null,
      spaces: [
        { id: "s-fin", name: "fin" },
        { id: "s-finance", name: "finance" },
      ],
      userId: null,
    };
    getFile.mockResolvedValue({ content: "x", source: "space", sha256: "" });
    await client.getFile(overlap, "Spaces/finance/GOAL.md");
    expect(getFile).toHaveBeenCalledWith({ spaceId: "s-finance" }, "GOAL.md");
  });

  it("rejects an unmapped space name", async () => {
    await expect(client.getFile(target, "Spaces/nope/x.md")).rejects.toThrow(
      /Unknown space folder/,
    );
    expect(getFile).not.toHaveBeenCalled();
  });

  it("rejects unsafe path segments before any API call", async () => {
    await expect(client.getFile(target, "Agent/../secrets.md")).rejects.toThrow(
      /Unsafe workspace path/,
    );
    expect(getFile).not.toHaveBeenCalled();
  });
});

describe("move / rename", () => {
  it("strips and re-prefixes destPath within the same source", async () => {
    movePath.mockResolvedValue({ destPath: "skills/foo.md" });
    const result = await client.movePath?.(
      target,
      "Agent/foo.md",
      "Agent/skills",
    );
    expect(movePath).toHaveBeenCalledWith(
      { agentId: "agent-1" },
      "foo.md",
      "skills",
    );
    expect(result).toEqual({ destPath: "Agent/skills/foo.md" });
  });

  it("refuses to move across sources", async () => {
    await expect(
      client.movePath?.(target, "Agent/foo.md", "User"),
    ).rejects.toThrow(/across workspace sources/);
    expect(movePath).not.toHaveBeenCalled();
  });

  it("refuses to rename across sources", async () => {
    await expect(
      client.renamePath?.(target, "Agent/foo.md", "User/foo.md"),
    ).rejects.toThrow(/across workspace sources/);
    expect(renamePath).not.toHaveBeenCalled();
  });
});
