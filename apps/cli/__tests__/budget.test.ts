import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const mocks = vi.hoisted(() => ({
  gqlMutate: vi.fn(),
  gqlQuery: vi.fn(),
}));

vi.mock("../src/lib/resolve-tenant-id.js", () => ({
  resolveTenantContext: vi.fn(async () => ({
    client: {},
    tenantId: "tenant-1",
  })),
}));

vi.mock("../src/lib/gql-client.js", () => ({
  gqlMutate: mocks.gqlMutate,
  gqlQuery: mocks.gqlQuery,
}));

import { registerBudgetCommand } from "../src/commands/budget.js";
import { setJsonMode } from "../src/lib/output.js";

afterEach(() => {
  vi.restoreAllMocks();
  mocks.gqlMutate.mockReset();
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
  registerBudgetCommand(program);
  return program;
}

describe("budget command", () => {
  it("upserts a user budget with userId and no agentId", async () => {
    mocks.gqlMutate.mockResolvedValue({
      upsertBudgetPolicy: {
        id: "budget-1",
        scope: "user",
        userId: "user-1",
        agentId: null,
        limitUsd: 25,
        period: "monthly",
        actionOnExceed: "PAUSE",
      },
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await makeProgram().parseAsync(
      [
        "budget",
        "upsert",
        "--stage",
        "dev",
        "--scope",
        "user",
        "--user",
        "user-1",
        "--limit-usd",
        "25",
      ],
      { from: "user" },
    );

    expect(mocks.gqlMutate).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({
        tenantId: "tenant-1",
        input: expect.objectContaining({
          scope: "user",
          userId: "user-1",
          agentId: null,
          limitUsd: 25,
        }),
      }),
    );
  });

  it("fails clearly when a user budget omits --user", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);

    await expect(
      makeProgram().parseAsync(
        [
          "budget",
          "upsert",
          "--stage",
          "dev",
          "--scope",
          "user",
          "--limit-usd",
          "25",
        ],
        { from: "user" },
      ),
    ).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(
      logSpy.mock.calls.map((call) => String(call[0])).join("\n"),
    ).toContain("--user <id> is required when --scope user.");
    expect(mocks.gqlMutate).not.toHaveBeenCalled();
  });

  it("prints budget status targets for user policies", async () => {
    mocks.gqlQuery.mockResolvedValue({
      budgetStatus: [
        {
          policy: {
            id: "budget-1",
            scope: "user",
            userId: "user-1",
            agentId: null,
            period: "monthly",
            limitUsd: 50,
          },
          spentUsd: 12.5,
          remainingUsd: 37.5,
          percentUsed: 25,
          status: "ok",
        },
      ],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await makeProgram().parseAsync(["budget", "status", "--stage", "dev"], {
      from: "user",
    });

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("TARGET");
    expect(output).toContain("user:user-1");
    expect(output).toContain("$12.50");
  });
});
