import { describe, expect, it, vi } from "vitest";
import { Command } from "commander";

import {
  AwsCliWorkspaceObjectStore,
  registerMigrateFolderCanonCommand,
} from "../src/commands/migrate-folder-canon.js";

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  };
});

describe("migrate-folder-canon command registration", () => {
  it("registers the migration command and Plan-B mode flags", () => {
    const program = new Command();
    registerMigrateFolderCanonCommand(program);

    const command = program.commands.find(
      (candidate) => candidate.name() === "migrate-folder-canon",
    );
    expect(command, "migrate-folder-canon command exists").toBeTruthy();
    const help = command!.helpInformation();
    expect(help).toMatch(/--stage/);
    expect(help).toMatch(/--tenant/);
    expect(help).toMatch(/--dry-run/);
    expect(help).toMatch(/--apply/);
    expect(help).toMatch(/--repair/);
    expect(help).toMatch(/--noop-check/);
    expect(help).toMatch(/--snapshot/);
  });

  it("paginates S3 list-objects-v2 results", async () => {
    execFileSyncMock
      .mockReturnValueOnce(
        JSON.stringify({
          Contents: [{ Key: "tenants/acme/agents/a/workspace/AGENTS.md" }],
          NextContinuationToken: "page-2",
        }),
      )
      .mockReturnValueOnce(
        JSON.stringify({
          Contents: [{ Key: "tenants/acme/agents/b/workspace/AGENTS.md" }],
        }),
      );

    const store = new AwsCliWorkspaceObjectStore("bucket");
    await expect(store.list("tenants/acme/agents/")).resolves.toEqual([
      "tenants/acme/agents/a/workspace/AGENTS.md",
      "tenants/acme/agents/b/workspace/AGENTS.md",
    ]);
    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
    expect(execFileSyncMock.mock.calls[1]?.[1]).toContain(
      "--continuation-token",
    );
    expect(execFileSyncMock.mock.calls[1]?.[1]).toContain("page-2");
  });
});
