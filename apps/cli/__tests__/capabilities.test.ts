/**
 * `thinkwork capabilities` tests (capability-mapping plan U5).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const mocks = vi.hoisted(() => ({
  gqlQuery: vi.fn(),
  printError: vi.fn(),
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

vi.mock("../src/ui.js", () => ({
  printError: mocks.printError,
}));

import { registerCapabilitiesCommand } from "../src/commands/capabilities.js";
import { setJsonMode } from "../src/lib/output.js";

afterEach(() => {
  vi.restoreAllMocks();
  mocks.gqlQuery.mockReset();
  mocks.printError.mockReset();
  setJsonMode(false);
  process.exitCode = undefined;
});

function makeProgram() {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  registerCapabilitiesCommand(program);
  return program;
}

function okInspection(overrides: Record<string, unknown> = {}) {
  return {
    capabilityInspector: {
      state: "ok",
      stateDetail: null,
      agentId: "agent-1",
      noUserBaseline: true,
      predicted: {
        computedAt: "2026-07-02T12:00:00.000Z",
        configFingerprint: "abcdef1234567890",
        items: [
          {
            capabilityClass: "skill",
            capabilityId: "approve-receipt",
            displayName: null,
            active: true,
            provenance: "agent: workspace folder",
            reason: null,
            detail: null,
            tokenStatus: null,
          },
          {
            capabilityClass: "mcp_server",
            capabilityId: "github",
            displayName: "GitHub",
            active: false,
            provenance: "tenant MCP registry",
            reason: "oauth_missing",
            detail: "user has not completed OAuth",
            tokenStatus: null,
          },
        ],
      },
      ...overrides,
    },
  };
}

describe("capabilities command", () => {
  it("renders the effective set grouped table with reasons for inactive items", async () => {
    mocks.gqlQuery.mockResolvedValue(okInspection());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await makeProgram().parseAsync(["capabilities", "--stage", "dev"], {
      from: "user",
    });

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("approve-receipt");
    expect(output).toContain("active");
    expect(output).toContain("oauth_missing");
    expect(output).toContain("fingerprint abcdef123456");
    expect(output).toContain("No-user baseline");
    expect(process.exitCode).toBeUndefined();
  });

  it("--json emits the raw inspection shape", async () => {
    mocks.gqlQuery.mockResolvedValue(okInspection());
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await makeProgram().parseAsync(
      ["capabilities", "--stage", "dev", "--json"],
      { from: "user" },
    );

    const parsed = JSON.parse(String(writeSpy.mock.calls[0][0]));
    expect(parsed.state).toBe("ok");
    expect(parsed.predicted.items).toHaveLength(2);
  });

  it("passes selection flags through as query variables", async () => {
    mocks.gqlQuery.mockResolvedValue(okInspection({ noUserBaseline: false }));
    vi.spyOn(console, "log").mockImplementation(() => {});

    await makeProgram().parseAsync(
      [
        "capabilities",
        "--stage",
        "dev",
        "--space",
        "space-1",
        "--profile",
        "prof-1",
        "--user",
        "user-1",
      ],
      { from: "user" },
    );

    expect(mocks.gqlQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        tenantId: "tenant-1",
        spaceId: "space-1",
        agentProfileId: "prof-1",
        perspectiveUserId: "user-1",
      }),
    );
  });

  it("invalid --space exits non-zero via printError, distinct from per-item reasons", async () => {
    mocks.gqlQuery.mockResolvedValue(
      okInspection({
        state: "invalid_selection",
        stateDetail: "space not found in tenant",
        predicted: null,
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await makeProgram().parseAsync(
      ["capabilities", "--stage", "dev", "--space", "nope"],
      { from: "user" },
    );

    expect(mocks.printError).toHaveBeenCalledWith(
      expect.stringContaining("space not found in tenant"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("resolution faults exit non-zero via printError", async () => {
    mocks.gqlQuery.mockResolvedValue(
      okInspection({
        state: "resolution_fault",
        stateDetail: "db unavailable",
        predicted: null,
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    await makeProgram().parseAsync(["capabilities", "--stage", "dev"], {
      from: "user",
    });

    expect(mocks.printError).toHaveBeenCalledWith(
      expect.stringContaining("db unavailable"),
    );
    expect(process.exitCode).toBe(1);
  });
});
