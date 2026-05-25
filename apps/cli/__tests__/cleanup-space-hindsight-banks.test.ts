import { describe, expect, it, vi } from "vitest";
import { Command } from "commander";

import {
  cleanupSpaceHindsightBanks,
  PsqlSpaceHindsightBankStore,
  registerCleanupSpaceHindsightBanksCommand,
  type SpaceHindsightBankStore,
} from "../src/commands/cleanup-space-hindsight-banks.js";

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

describe("cleanup-space-hindsight-banks", () => {
  it("registers the dry-run-first cleanup command", () => {
    const program = new Command();
    registerCleanupSpaceHindsightBanksCommand(program);

    const command = program.commands.find(
      (candidate) => candidate.name() === "cleanup-space-hindsight-banks",
    );
    expect(command).toBeTruthy();
    const help = command!.helpInformation();
    expect(help).toMatch(/--stage/);
    expect(help).toMatch(/--database-url/);
    expect(help).toMatch(/--apply/);
  });

  it("lists space banks without deleting in dry-run mode", async () => {
    const store: SpaceHindsightBankStore = {
      listSpaceBanks: vi
        .fn()
        .mockResolvedValue([{ bankId: "space_finance", rowCount: 2 }]),
      deleteSpaceBanks: vi.fn(),
    };

    await expect(
      cleanupSpaceHindsightBanks({ stage: "dev", apply: false, store }),
    ).resolves.toEqual({
      stage: "dev",
      apply: false,
      banks: [{ bankId: "space_finance", rowCount: 2 }],
      deletedTables: [],
    });
    expect(store.deleteSpaceBanks).not.toHaveBeenCalled();
  });

  it("uses psql to list only space-prefixed Hindsight banks", async () => {
    execFileSyncMock.mockReturnValueOnce("space_finance|3\nuser_ignored|9\n");

    const store = new PsqlSpaceHindsightBankStore("postgres://db");

    await expect(store.listSpaceBanks()).resolves.toEqual([
      { bankId: "space_finance", rowCount: 3 },
    ]);
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "psql",
      expect.arrayContaining(["postgres://db", "-At", "-F", "|"]),
      expect.objectContaining({ maxBuffer: 16 * 1024 * 1024 }),
    );
  });
});
