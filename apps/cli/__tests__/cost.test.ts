import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const mocks = vi.hoisted(() => ({
  gqlQuery: vi.fn(),
}));

vi.mock("../src/lib/resolve-tenant-id.js", () => ({
  resolveTenantContext: vi.fn(async () => ({
    client: {},
    tenantId: "tenant-1",
  })),
}));

vi.mock("../src/lib/gql-client.js", () => ({
  gqlQuery: mocks.gqlQuery,
}));

import { registerCostCommand } from "../src/commands/cost.js";
import { setJsonMode } from "../src/lib/output.js";

afterEach(() => {
  vi.restoreAllMocks();
  mocks.gqlQuery.mockReset();
  setJsonMode(false);
});

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  registerCostCommand(program);
  return program;
}

describe("cost command", () => {
  it("prints user cost rows with identity, total, and events", async () => {
    mocks.gqlQuery.mockResolvedValue({
      costByUser: [
        {
          userId: "user-1",
          userName: "Ada Lovelace",
          userEmail: "ada@example.com",
          totalUsd: 12.5,
          eventCount: 7,
          isSystem: false,
        },
      ],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await makeProgram().parseAsync(["cost", "by-user", "--stage", "dev"], {
      from: "user",
    });

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("USER");
    expect(output).toContain("Ada Lovelace");
    expect(output).toContain("ada@example.com");
    expect(output).toContain("$12.50");
    expect(output).toContain("7");
  });

  it("emits raw user cost rows in JSON mode, including system spend", async () => {
    mocks.gqlQuery.mockResolvedValue({
      costByUser: [
        {
          userId: null,
          userName: "System / unattributed",
          userEmail: null,
          totalUsd: 3.25,
          eventCount: 2,
          isSystem: true,
        },
      ],
    });
    setJsonMode(true);
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await makeProgram().parseAsync(["cost", "by-user", "--stage", "dev"], {
      from: "user",
    });

    const payload = JSON.parse(String(stdoutSpy.mock.calls[0]?.[0]));
    expect(payload.items).toEqual([
      expect.objectContaining({
        userId: null,
        userName: "System / unattributed",
        isSystem: true,
      }),
    ]);
  });

  it("keeps the legacy by-agent command registered", () => {
    const cost = makeProgram().commands.find((cmd) => cmd.name() === "cost");
    expect(cost?.commands.map((cmd) => cmd.name())).toContain("by-agent");
  });
});
