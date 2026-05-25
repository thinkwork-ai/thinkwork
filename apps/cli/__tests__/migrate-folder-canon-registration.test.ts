import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

import {
  AwsCliWorkspaceObjectStore,
  registerMigrateFolderCanonCommand,
} from "../src/commands/migrate-folder-canon.js";

const execFileSyncMock = vi.hoisted(() => vi.fn());
const migrateFolderCanonMock = vi.hoisted(() => vi.fn());

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

vi.mock("../src/lib/migrations/folder-canon-migrator.js", () => ({
  migrateFolderCanon: migrateFolderCanonMock,
}));

describe("migrate-folder-canon command registration", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    migrateFolderCanonMock.mockReset();
    process.exitCode = undefined;
  });

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
    expect(help).toMatch(/--cleanup-legacy-files/);
  });

  it("passes cleanupLegacyFiles to the migrator", async () => {
    migrateFolderCanonMock.mockResolvedValueOnce({
      mode: "apply",
      tenantReports: [],
      pendingOperations: 0,
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    registerMigrateFolderCanonCommand(program);

    await program.parseAsync(
      [
        "migrate-folder-canon",
        "--workspace-bucket",
        "bucket",
        "--apply",
        "--cleanup-legacy-files",
      ],
      { from: "user" },
    );

    expect(migrateFolderCanonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "apply",
        cleanupLegacyFiles: true,
      }),
    );
    log.mockRestore();
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
    expect(execFileSyncMock.mock.calls[0]?.[1]).toContain("--no-paginate");
    expect(execFileSyncMock.mock.calls[0]?.[1]).toContain("--query");
    expect(execFileSyncMock.mock.calls[1]?.[1]).toContain(
      "--continuation-token",
    );
    expect(execFileSyncMock.mock.calls[1]?.[1]).toContain("page-2");
    expect(execFileSyncMock.mock.calls[0]?.[2]).toMatchObject({
      maxBuffer: 16 * 1024 * 1024,
    });
  });
});
