import { describe, expect, it, vi } from "vitest";

import {
  REQUIRED_RETIREMENT_SURFACES,
  evaluateRetirementCertification,
  type RetirementCertificationInput,
  type SurfaceEvidence,
} from "../lib/harness/retirement-certification.js";
import {
  loadEvalEvidence,
  loadSurfaceEvidence,
  parseArgs,
  poolConfig,
} from "../../scripts/proofs/agentcore-harness-retirement-certification.js";

function surface(
  name: string,
  overrides: Partial<SurfaceEvidence> = {},
): SurfaceEvidence {
  return {
    surface: name,
    threadId: `thread-${name}`,
    turnId: `turn-${name}`,
    runtimeType: "agentcore",
    status: "succeeded",
    finalized: true,
    usagePresent: true,
    costRows: 2,
    piCostRows: 0,
    invocationSource: "chat_message",
    completedOperations: ["tools.call"],
    principalIds: [`principal-${name}`],
    credentialOwners: [`owner-${name}`],
    semanticEvidence: true,
    semanticDetail: "required durable evidence present",
    ...overrides,
  };
}

function passingInput(): RetirementCertificationInput {
  return {
    windowStart: new Date("2026-07-19T06:00:00.000Z"),
    windowEnd: new Date("2026-07-20T06:00:00.000Z"),
    minimumWindowHours: 24,
    minimumSuccessRate: 0.95,
    maximumP95DurationMs: 120_000,
    runtimeStats: [
      {
        runtimeType: "pi",
        turns: 10,
        succeeded: 10,
        failed: 0,
        missingFinalization: 0,
        missingUsage: 0,
        missingCost: 0,
        p50DurationMs: 4_000,
        p95DurationMs: 8_000,
        totalCostUsd: 0.01,
      },
      {
        runtimeType: "agentcore",
        turns: 20,
        succeeded: 20,
        failed: 0,
        missingFinalization: 0,
        missingUsage: 0,
        missingCost: 0,
        p50DurationMs: 8_000,
        p95DurationMs: 20_000,
        totalCostUsd: 0.04,
      },
    ],
    surfaces: REQUIRED_RETIREMENT_SURFACES.map((name) => surface(name)),
    evals: [
      {
        id: "eval-pi",
        expectedRuntime: "pi",
        actualRuntime: "pi",
        status: "completed",
        totalTests: 1,
        passed: 1,
        failed: 0,
        errored: 0,
        costPartial: false,
      },
      {
        id: "eval-agentcore",
        expectedRuntime: "agentcore",
        actualRuntime: "agentcore",
        status: "completed",
        totalTests: 1,
        passed: 1,
        failed: 0,
        errored: 0,
        costPartial: false,
      },
    ],
    mixedRuntimeThreads: 0,
    piCostRowsOnAgentcoreTurns: 0,
    orphanToolStarts: 0,
    uncertainToolOutcomes: 0,
    enrollmentDriftFailures: 0,
    canaryCount: 2,
    canaryMatches: 0,
    rollbackRehearsed: true,
    capacityAdmitted: true,
  };
}

describe("AgentCore Harness retirement certification", () => {
  it("pins named evidence to an exact thread turn when supplied", () => {
    const priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://example.invalid/thinkwork";
    try {
      const args = parseArgs([
        "--tenant-id",
        "0015953e-aa13-4cab-8398-2e70f73dda63",
        "--since",
        "2026-07-19T06:00:00.000Z",
        "--case",
        "multiplayer-eric=88c5d570-ac26-4ddf-8c4a-a228b8720442@88ecd2f4-eab3-4759-8dfe-2b4e313c83b9",
      ]);

      expect(args.cases).toEqual([
        {
          surface: "multiplayer-eric",
          threadId: "88c5d570-ac26-4ddf-8c4a-a228b8720442",
          turnId: "88ecd2f4-eab3-4759-8dfe-2b4e313c83b9",
        },
      ]);
    } finally {
      if (priorDatabaseUrl == null) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = priorDatabaseUrl;
    }
  });

  it("rejects named surface evidence outside the certification window", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const since = new Date("2026-07-19T10:09:32.000Z");
    const until = new Date("2026-07-20T10:09:32.000Z");

    const evidence = await loadSurfaceEvidence(
      { query } as never,
      {
        tenantId: "0015953e-aa13-4cab-8398-2e70f73dda63",
        since,
        until,
      } as never,
      {
        surface: "memory",
        threadId: "48cf78a7-f56e-481a-b952-4cd6212f01f2",
        turnId: "f9601018-9f70-4330-ad6f-cc23aa542a5e",
      },
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain(
      "created_at >= $4 AND created_at < $5",
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      "0015953e-aa13-4cab-8398-2e70f73dda63",
      "48cf78a7-f56e-481a-b952-4cd6212f01f2",
      "f9601018-9f70-4330-ad6f-cc23aa542a5e",
      since,
      until,
    ]);
    expect(evidence).toMatchObject({
      status: "missing",
      semanticEvidence: false,
      semanticDetail: "thread has no turn in the certification window",
    });
  });

  it("rejects named eval evidence outside the certification window", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const since = new Date("2026-07-19T10:09:32.000Z");
    const until = new Date("2026-07-20T10:09:32.000Z");

    const evidence = await loadEvalEvidence(
      { query } as never,
      {
        tenantId: "0015953e-aa13-4cab-8398-2e70f73dda63",
        since,
        until,
        evals: [
          {
            runtimeType: "agentcore",
            runId: "685051d2-3a0e-43a2-9f2d-9481285035a8",
          },
        ],
      } as never,
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain(
      "created_at >= $3 AND created_at < $4",
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      "0015953e-aa13-4cab-8398-2e70f73dda63",
      "685051d2-3a0e-43a2-9f2d-9481285035a8",
      since,
      until,
    ]);
    expect(evidence).toEqual([
      expect.objectContaining({
        id: "685051d2-3a0e-43a2-9f2d-9481285035a8",
        expectedRuntime: "agentcore",
        actualRuntime: null,
        status: "missing",
      }),
    ]);
  });

  it("rejects unknown or duplicate evidence keys before querying production data", () => {
    const priorDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://example.invalid/thinkwork";
    const exit = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
    const common = [
      "--tenant-id",
      "0015953e-aa13-4cab-8398-2e70f73dda63",
      "--since",
      "2026-07-19T06:00:00.000Z",
    ];
    try {
      expect(() =>
        parseArgs([
          ...common,
          "--case",
          "not-a-surface=88c5d570-ac26-4ddf-8c4a-a228b8720442",
        ]),
      ).toThrow("exit:2");
      expect(() =>
        parseArgs([
          ...common,
          "--case",
          "memory=88c5d570-ac26-4ddf-8c4a-a228b8720442",
          "--case",
          "memory=07123a9b-be72-4b84-b88e-0958c0893d22",
        ]),
      ).toThrow("exit:2");
      expect(() =>
        parseArgs([
          ...common,
          "--eval",
          "agentcore=bd9a0de1-2a19-4a2f-aad0-c238cca2a741",
          "--eval",
          "agentcore=448e4b83-89a8-41d7-8c88-9b32ab777fb1",
        ]),
      ).toThrow("exit:2");
    } finally {
      exit.mockRestore();
      if (priorDatabaseUrl == null) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = priorDatabaseUrl;
    }
  });

  it("honors only the explicit deployed no-verify database mode", () => {
    expect(
      poolConfig("postgres://user:pass@example.test/db?sslmode=no-verify"),
    ).toMatchObject({
      connectionString: "postgres://user:pass@example.test/db",
      ssl: { rejectUnauthorized: false },
    });
    expect(
      poolConfig("postgres://user:pass@example.test/db?sslmode=verify-full"),
    ).toEqual({
      connectionString:
        "postgres://user:pass@example.test/db?sslmode=verify-full",
    });
  });

  it("passes only with a complete 24-hour parallel matrix", () => {
    const result = evaluateRetirementCertification(passingInput());

    expect(result.verdict).toBe("PASS");
    expect(result.missingSurfaces).toEqual([]);
    expect(result.checks.every((row) => row.status === "pass")).toBe(true);
  });

  it("stays in progress before the soak window and operational gates close", () => {
    const input = passingInput();
    input.windowEnd = new Date("2026-07-19T12:00:00.000Z");
    input.capacityAdmitted = false;
    input.rollbackRehearsed = false;

    const result = evaluateRetirementCertification(input);

    expect(result.verdict).toBe("IN_PROGRESS");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "parallel_soak_window",
          status: "pending",
        }),
        expect.objectContaining({
          name: "capacity_admitted",
          status: "pending",
        }),
        expect.objectContaining({
          name: "rollback_rehearsed",
          status: "pending",
        }),
      ]),
    );
  });

  it("fails on mixed runtime, Pi cost contamination, or missing durable evidence", () => {
    const input = passingInput();
    input.mixedRuntimeThreads = 1;
    input.piCostRowsOnAgentcoreTurns = 2;
    input.surfaces = input.surfaces.map((row) =>
      row.surface === "sandbox"
        ? { ...row, costRows: 0, semanticEvidence: false }
        : row,
    );

    const result = evaluateRetirementCertification(input);

    expect(result.verdict).toBe("FAIL");
    expect(result.missingSurfaces).toContain("sandbox");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "mixed_runtime_threads",
          status: "fail",
        }),
        expect.objectContaining({
          name: "pi_cost_rows_on_agentcore_turns",
          status: "fail",
        }),
        expect.objectContaining({ name: "surface:sandbox", status: "fail" }),
      ]),
    );
  });

  it("requires exact-user multiplayer and Twenty credential-owner separation", () => {
    const input = passingInput();
    input.surfaces = input.surfaces.map((row) => {
      if (row.surface === "multiplayer-eric") {
        return { ...row, principalIds: ["shared-user"] };
      }
      if (row.surface === "multiplayer-sursum") {
        return { ...row, principalIds: ["shared-user"] };
      }
      if (row.surface === "twenty-eric") {
        return { ...row, credentialOwners: ["shared-grant"] };
      }
      if (row.surface === "twenty-sursum") {
        return { ...row, credentialOwners: ["shared-grant"] };
      }
      return row;
    });

    const result = evaluateRetirementCertification(input);

    expect(result.verdict).toBe("FAIL");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "multiplayer_distinct_principals",
          status: "fail",
        }),
        expect.objectContaining({
          name: "twenty_distinct_credential_owners",
          status: "fail",
        }),
      ]),
    );
  });
});
