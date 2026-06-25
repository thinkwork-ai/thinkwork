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

import { registerTraceCommand } from "../src/commands/trace.js";
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
  registerTraceCommand(program);
  return program;
}

describe("trace command", () => {
  it("prints a clear message when a turn has no invocation logs", async () => {
    mocks.gqlQuery.mockResolvedValue({ turnInvocationLogs: [] });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await makeProgram().parseAsync(
      ["trace", "turn", "turn-1", "--stage", "dev"],
      { from: "user" },
    );

    expect(logSpy).toHaveBeenCalledWith(
      "No model invocation logs found for this turn.",
    );
  });

  it("prints reconciliation state for turn invocation logs", async () => {
    mocks.gqlQuery.mockResolvedValue({
      turnInvocationLogs: [
        {
          requestId: "bedrock-request-1234567890",
          modelId: "anthropic.claude-sonnet-4",
          timestamp: "2026-06-25T12:00:00.000Z",
          inputTokenCount: 1200,
          outputTokenCount: 300,
          cacheReadTokenCount: 25,
          toolCount: 2,
          costUsd: 0.0042,
          reconciliationState: "invocation-reconciled",
          reconciliationConfidence: "high",
          reconciliationDiagnostic: "matched by provider request id",
        },
      ],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await makeProgram().parseAsync(
      ["trace", "turn", "turn-1", "--stage", "dev"],
      { from: "user" },
    );

    const output = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("STATE");
    expect(output).toContain("CONF");
    expect(output).toContain("invocation-reconciled");
    expect(output).toContain("high");
    expect(output).toContain("matched by provider request id");
  });
});
