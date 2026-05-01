/**
 * Routines publish/trigger flow tests (Plan §U7).
 *
 * Test-first per the U7 execution note. Covers the live cutover from
 * `engine='legacy_python'` to `engine='step_functions'` across:
 *   - createRoutine.mutation.ts
 *   - publishRoutineVersion.mutation.ts
 *   - updateRoutine.mutation.ts
 *   - triggerRoutineRun.mutation.ts
 *
 * Mocks the AWS SFN boundary, the validator, the DB, and the auth gate.
 * The resolvers are tested through their pure logic — IAM grants and
 * Terraform wiring are out of scope here (verified by `pnpm plan -s dev`).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Hoisted mocks ----

const {
  mockSfnSend,
  mockValidate,
  mockRequireAdminOrApiKeyCaller,
  mockSelectRows,
  mockTransaction,
} = vi.hoisted(() => ({
  mockSfnSend: vi.fn(),
  mockValidate: vi.fn(),
  mockRequireAdminOrApiKeyCaller: vi.fn(),
  mockSelectRows: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: class {
    send = mockSfnSend;
  },
  CreateStateMachineCommand: class CreateStateMachineCommand {
    constructor(public input: unknown) {}
  },
  CreateStateMachineAliasCommand: class CreateStateMachineAliasCommand {
    constructor(public input: unknown) {}
  },
  PublishStateMachineVersionCommand: class PublishStateMachineVersionCommand {
    constructor(public input: unknown) {}
  },
  UpdateStateMachineCommand: class UpdateStateMachineCommand {
    constructor(public input: unknown) {}
  },
  UpdateStateMachineAliasCommand: class UpdateStateMachineAliasCommand {
    constructor(public input: unknown) {}
  },
  StartExecutionCommand: class StartExecutionCommand {
    constructor(public input: unknown) {}
  },
}));

vi.mock("../handlers/routine-asl-validator.js", () => ({
  validateRoutineAsl: mockValidate,
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireAdminOrApiKeyCaller: mockRequireAdminOrApiKeyCaller,
}));

// db.transaction(fn) → fn(tx); both db.select() and tx.select() route through
// the same mockSelectRows queue. db.insert(...).values(...).returning() also
// returns the next queued row set.
vi.mock("../graphql/utils.js", () => {
  // `where()` is itself awaitable (returns a Promise<Rows[]>) AND has
  // `.limit` / `.orderBy` chaining for the few resolvers that use them.
  // Drizzle's real query builder is thenable; we recreate that here.
  const makeWhereResult = () => {
    const promise = Promise.resolve(mockSelectRows());
    return Object.assign(promise, {
      limit: () => Promise.resolve(mockSelectRows()),
      orderBy: () => ({ limit: () => Promise.resolve(mockSelectRows()) }),
    });
  };
  const chainSelect = () => ({
    select: () => ({
      from: () => ({
        where: () => makeWhereResult(),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockSelectRows()),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockSelectRows()),
        }),
      }),
    }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      mockTransaction();
      return fn(chainSelect());
    },
  });
  return {
    db: chainSelect(),
    eq: (...a: unknown[]) => ({ _eq: a }),
    and: (...a: unknown[]) => ({ _and: a }),
    routines: { id: "id", tenant_id: "tenant_id" },
    threadTurns: { id: "id" },
    snakeToCamel: (row: unknown) => row,
  };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
  routines: {
    id: "routines.id",
    tenant_id: "routines.tenant_id",
    name: "routines.name",
    engine: "routines.engine",
    state_machine_arn: "routines.state_machine_arn",
    state_machine_alias_arn: "routines.state_machine_alias_arn",
    current_version: "routines.current_version",
    documentation_md: "routines.documentation_md",
    status: "routines.status",
  },
  routineAslVersions: {
    id: "routine_asl_versions.id",
    routine_id: "routine_asl_versions.routine_id",
    tenant_id: "routine_asl_versions.tenant_id",
    version_number: "routine_asl_versions.version_number",
  },
  routineExecutions: {
    id: "routine_executions.id",
    tenant_id: "routine_executions.tenant_id",
    routine_id: "routine_executions.routine_id",
    sfn_execution_arn: "routine_executions.sfn_execution_arn",
    status: "routine_executions.status",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => ({ _eq: a }),
  and: (...a: unknown[]) => ({ _and: a }),
  desc: (col: unknown) => ({ _desc: col }),
}));

// Stub out the routines env-snapshot reads.
beforeEach(() => {
  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCOUNT_ID = "123456789012";
  process.env.STAGE = "dev";
  process.env.ROUTINES_EXECUTION_ROLE_ARN =
    "arn:aws:iam::123456789012:role/thinkwork-dev-routines-execution-role";
  process.env.ROUTINE_APPROVAL_CALLBACK_FUNCTION_NAME =
    "thinkwork-dev-api-routine-approval-callback";
  mockSfnSend.mockReset();
  mockValidate.mockReset();
  mockRequireAdminOrApiKeyCaller.mockReset();
  mockSelectRows.mockReset();
  mockTransaction.mockReset();
  // Default: caller is admin, validator passes.
  mockRequireAdminOrApiKeyCaller.mockResolvedValue("admin");
  mockValidate.mockResolvedValue({ valid: true, errors: [], warnings: [] });
});

const ctx = {
  auth: { tenantId: "tenant-a", authType: "cognito" },
} as never;

const minimalAsl = {
  StartAt: "Done",
  States: { Done: { Type: "Succeed" } },
};

// ---------------------------------------------------------------------------
// createRoutine
// ---------------------------------------------------------------------------

describe("createRoutine — Step Functions live cutover", () => {
  it("creates state machine + alias + DB row when ASL is valid", async () => {
    // Sequence: requireAdminOrApiKeyCaller (handled), validate (handled),
    // CreateStateMachine, CreateStateMachineAlias, then DB inserts.
    mockSfnSend
      .mockResolvedValueOnce({
        stateMachineArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a",
      })
      .mockResolvedValueOnce({
        stateMachineVersionArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:1",
      })
      .mockResolvedValueOnce({
        stateMachineAliasArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:live",
      });
    mockSelectRows
      .mockReturnValueOnce([
        {
          id: "routine-a",
          tenant_id: "tenant-a",
          name: "Nightly digest",
          engine: "step_functions",
          state_machine_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a",
          state_machine_alias_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:live",
          current_version: 1,
        },
      ])
      .mockReturnValueOnce([{ id: "asl-version-1" }]);

    const { createRoutine } = await import(
      "../graphql/resolvers/routines/createRoutine.mutation.js"
    );

    const result = await createRoutine(
      null,
      {
        input: {
          tenantId: "tenant-a",
          name: "Nightly digest",
          asl: JSON.stringify(minimalAsl),
          markdownSummary: "## Nightly digest",
          stepManifest: JSON.stringify({}),
        },
      },
      ctx,
    );

    expect(mockRequireAdminOrApiKeyCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-a",
      "create_routine",
    );
    expect(mockValidate).toHaveBeenCalledTimes(1);
    // 3 SFN calls: CreateStateMachine, PublishStateMachineVersion, CreateStateMachineAlias.
    expect(mockSfnSend).toHaveBeenCalledTimes(3);
    const r = result as { engine: string; currentVersion?: number; current_version?: number };
    expect(r.engine).toBe("step_functions");
    expect(r.currentVersion ?? r.current_version).toBe(1);
  });

  it("returns validator errors and creates no state machine on invalid ASL (covers AE3)", async () => {
    mockValidate.mockResolvedValueOnce({
      valid: false,
      errors: [
        {
          code: "unknown_resource_arn",
          message: "Task state 'X' uses an unrecognized Resource ARN.",
          stateName: "X",
        },
      ],
      warnings: [],
    });

    const { createRoutine } = await import(
      "../graphql/resolvers/routines/createRoutine.mutation.js"
    );

    await expect(
      createRoutine(
        null,
        {
          input: {
            tenantId: "tenant-a",
            name: "Bad routine",
            asl: JSON.stringify(minimalAsl),
            markdownSummary: "x",
            stepManifest: JSON.stringify({}),
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/unrecognized Resource ARN/i);

    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it("requires tenant admin role before any SFN call", async () => {
    mockRequireAdminOrApiKeyCaller.mockRejectedValueOnce(
      new Error("Tenant admin role required"),
    );

    const { createRoutine } = await import(
      "../graphql/resolvers/routines/createRoutine.mutation.js"
    );

    await expect(
      createRoutine(
        null,
        {
          input: {
            tenantId: "tenant-a",
            name: "x",
            asl: JSON.stringify(minimalAsl),
            markdownSummary: "x",
            stepManifest: JSON.stringify({}),
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/Tenant admin/i);

    expect(mockValidate).not.toHaveBeenCalled();
    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// publishRoutineVersion
// ---------------------------------------------------------------------------

describe("publishRoutineVersion — version + alias flip", () => {
  it("UpdateStateMachine + PublishStateMachineVersion + UpdateAlias on success", async () => {
    // Routine lookup → admin gate → validator → prior-version lookup
    // → 3 SFN calls → version insert → routine update.
    mockSelectRows
      .mockReturnValueOnce([
        {
          id: "routine-a",
          tenant_id: "tenant-a",
          engine: "step_functions",
          state_machine_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a",
          state_machine_alias_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:live",
          current_version: 1,
        },
      ])
      .mockReturnValueOnce([
        {
          version_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:1",
        },
      ])
      .mockReturnValueOnce([
        {
          id: "asl-v2",
          routine_id: "routine-a",
          tenant_id: "tenant-a",
          version_number: 2,
        },
      ]);

    mockSfnSend
      .mockResolvedValueOnce({}) // UpdateStateMachine
      .mockResolvedValueOnce({
        stateMachineVersionArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:2",
      })
      .mockResolvedValueOnce({}); // UpdateStateMachineAlias

    const { publishRoutineVersion } = await import(
      "../graphql/resolvers/routines/publishRoutineVersion.mutation.js"
    );

    const result = await publishRoutineVersion(
      null,
      {
        input: {
          routineId: "routine-a",
          asl: JSON.stringify(minimalAsl),
          markdownSummary: "## Updated",
          stepManifest: JSON.stringify({}),
        },
      },
      ctx,
    );

    expect(mockSfnSend).toHaveBeenCalledTimes(3);
    const v = result as { versionNumber?: number; version_number?: number };
    expect(v.versionNumber ?? v.version_number).toBe(2);
  });

  it("returns validator errors and skips SFN calls on invalid ASL", async () => {
    mockSelectRows.mockReturnValueOnce([
      {
        id: "routine-a",
        tenant_id: "tenant-a",
        engine: "step_functions",
        state_machine_arn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a",
        state_machine_alias_arn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:live",
        current_version: 1,
      },
    ]);
    mockValidate.mockResolvedValueOnce({
      valid: false,
      errors: [
        { code: "asl_syntax", message: "Missing Next on state X" },
      ],
      warnings: [],
    });

    const { publishRoutineVersion } = await import(
      "../graphql/resolvers/routines/publishRoutineVersion.mutation.js"
    );

    await expect(
      publishRoutineVersion(
        null,
        {
          input: {
            routineId: "routine-a",
            asl: JSON.stringify(minimalAsl),
            markdownSummary: "x",
            stepManifest: JSON.stringify({}),
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/Missing Next on state X/);

    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it("rejects publish on a legacy_python routine — must migrate first", async () => {
    mockSelectRows.mockReturnValueOnce([
      {
        id: "routine-legacy",
        tenant_id: "tenant-a",
        engine: "legacy_python",
        state_machine_arn: null,
        state_machine_alias_arn: null,
        current_version: null,
      },
    ]);

    const { publishRoutineVersion } = await import(
      "../graphql/resolvers/routines/publishRoutineVersion.mutation.js"
    );

    await expect(
      publishRoutineVersion(
        null,
        {
          input: {
            routineId: "routine-legacy",
            asl: JSON.stringify(minimalAsl),
            markdownSummary: "x",
            stepManifest: JSON.stringify({}),
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/legacy/i);

    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// triggerRoutineRun
// ---------------------------------------------------------------------------

describe("triggerRoutineRun — SFN.StartExecution swap", () => {
  it("calls SFN StartExecution against the alias ARN and inserts a routine_executions row", async () => {
    mockSelectRows
      .mockReturnValueOnce([
        {
          id: "routine-a",
          tenant_id: "tenant-a",
          engine: "step_functions",
          state_machine_alias_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:live",
        },
      ])
      .mockReturnValueOnce([
        {
          id: "exec-row-1",
          tenant_id: "tenant-a",
          routine_id: "routine-a",
          sfn_execution_arn:
            "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-routine-routine-a:exec-1",
          status: "running",
        },
      ]);

    mockSfnSend.mockResolvedValueOnce({
      executionArn:
        "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-routine-routine-a:exec-1",
      startDate: new Date(),
    });

    const { triggerRoutineRun } = await import(
      "../graphql/resolvers/routines/triggerRoutineRun.mutation.js"
    );

    const result = await triggerRoutineRun(
      null,
      { routineId: "routine-a" },
      ctx,
    );

    expect(mockRequireAdminOrApiKeyCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-a",
      "trigger_routine_run",
    );
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    const startCall = mockSfnSend.mock.calls[0][0] as {
      input: { stateMachineArn: string };
    };
    expect(startCall.input.stateMachineArn).toContain(":live");
    expect((result as { status: string }).status).toBe("running");
  });

  it("rejects trigger on a legacy_python routine with a deprecation error (not a silent fallback)", async () => {
    mockSelectRows.mockReturnValueOnce([
      {
        id: "routine-legacy",
        tenant_id: "tenant-a",
        engine: "legacy_python",
        state_machine_alias_arn: null,
      },
    ]);

    const { triggerRoutineRun } = await import(
      "../graphql/resolvers/routines/triggerRoutineRun.mutation.js"
    );

    await expect(
      triggerRoutineRun(null, { routineId: "routine-legacy" }, ctx),
    ).rejects.toThrow(/legacy_python/i);

    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});
