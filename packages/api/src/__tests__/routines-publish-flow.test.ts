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
  mockRequireTenantMember,
  mockSelectRows,
  mockExecuteRows,
  mockInsertValues,
  mockTransaction,
} = vi.hoisted(() => ({
  mockSfnSend: vi.fn(),
  mockValidate: vi.fn(),
  mockRequireAdminOrApiKeyCaller: vi.fn(),
  mockRequireTenantMember: vi.fn(),
  mockSelectRows: vi.fn(),
  mockExecuteRows: vi.fn(),
  mockInsertValues: vi.fn(),
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
  requireTenantMember: mockRequireTenantMember,
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
      values: (values: unknown) => {
        mockInsertValues(values);
        return {
          returning: () => Promise.resolve(mockSelectRows()),
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockSelectRows()),
        }),
      }),
    }),
    execute: () => Promise.resolve({ rows: mockExecuteRows() }),
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
    description: "routines.description",
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
    state_machine_arn: "routine_asl_versions.state_machine_arn",
    version_arn: "routine_asl_versions.version_arn",
    asl_json: "routine_asl_versions.asl_json",
    markdown_summary: "routine_asl_versions.markdown_summary",
    step_manifest_json: "routine_asl_versions.step_manifest_json",
  },
  routineExecutions: {
    id: "routine_executions.id",
    tenant_id: "routine_executions.tenant_id",
    routine_id: "routine_executions.routine_id",
    sfn_execution_arn: "routine_executions.sfn_execution_arn",
    routine_asl_version_id: "routine_executions.routine_asl_version_id",
    status: "routine_executions.status",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => ({ _eq: a }),
  and: (...a: unknown[]) => ({ _and: a }),
  desc: (col: unknown) => ({ _desc: col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
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
  process.env.EMAIL_SEND_FUNCTION_NAME = "thinkwork-dev-api-email-send";
  process.env.ROUTINE_TASK_PYTHON_FUNCTION_NAME =
    "thinkwork-dev-api-routine-task-python";
  process.env.ADMIN_OPS_MCP_FUNCTION_NAME = "thinkwork-dev-api-admin-ops-mcp";
  process.env.SLACK_SEND_FUNCTION_NAME = "thinkwork-dev-api-slack-send";
  mockSfnSend.mockReset();
  mockValidate.mockReset();
  mockRequireAdminOrApiKeyCaller.mockReset();
  mockRequireTenantMember.mockReset();
  mockSelectRows.mockReset();
  mockExecuteRows.mockReset();
  mockInsertValues.mockReset();
  mockTransaction.mockReset();
  mockExecuteRows.mockReturnValue([{ exists: 1 }]);
  // Default: caller is admin, validator passes.
  mockRequireAdminOrApiKeyCaller.mockResolvedValue("admin");
  mockRequireTenantMember.mockResolvedValue("admin");
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

    const { createRoutine } =
      await import("../graphql/resolvers/routines/createRoutine.mutation.js");

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
    const r = result as {
      engine: string;
      currentVersion?: number;
      current_version?: number;
    };
    expect(r.engine).toBe("step_functions");
    expect(r.currentVersion ?? r.current_version).toBe(1);
  });

  it("authors supported intent-only input before creating the state machine", async () => {
    mockSfnSend
      .mockResolvedValueOnce({
        stateMachineArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a",
      })
      .mockResolvedValueOnce({
        stateMachineVersionArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:1",
      })
      .mockResolvedValueOnce({});
    mockSelectRows
      .mockReturnValueOnce([
        {
          id: "routine-a",
          tenant_id: "tenant-a",
          name: "Check Austin Weather",
          engine: "step_functions",
          state_machine_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a",
          state_machine_alias_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:live",
          current_version: 1,
        },
      ])
      .mockReturnValueOnce([{ id: "asl-version-1" }]);

    const { createRoutine } =
      await import("../graphql/resolvers/routines/createRoutine.mutation.js");

    await createRoutine(
      null,
      {
        input: {
          tenantId: "tenant-a",
          name: "Check Austin Weather",
          description:
            "Check the weather in Austin and email it to ericodom37@gmail.com.",
        },
      },
      ctx,
    );

    expect(mockValidate).toHaveBeenCalledTimes(1);
    expect(mockValidate.mock.calls[0][0].asl.StartAt).toBe(
      "FetchAustinWeather",
    );
    expect(mockSfnSend).toHaveBeenCalledTimes(3);
  });

  it("accepts parsed AWSJSON objects for reviewed draft artifacts", async () => {
    mockSfnSend
      .mockResolvedValueOnce({
        stateMachineArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a",
      })
      .mockResolvedValueOnce({
        stateMachineVersionArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:1",
      })
      .mockResolvedValueOnce({});
    mockSelectRows
      .mockReturnValueOnce([
        {
          id: "routine-a",
          tenant_id: "tenant-a",
          name: "Reviewed draft",
          engine: "step_functions",
          current_version: 1,
        },
      ])
      .mockReturnValueOnce([{ id: "asl-version-1" }]);

    const { createRoutine } =
      await import("../graphql/resolvers/routines/createRoutine.mutation.js");

    await createRoutine(
      null,
      {
        input: {
          tenantId: "tenant-a",
          name: "Reviewed draft",
          asl: minimalAsl,
          markdownSummary: "## Reviewed draft",
          stepManifest: { definition: { kind: "recipe_graph", steps: [] } },
        },
      },
      ctx,
    );

    expect(mockValidate).toHaveBeenCalledWith({ asl: minimalAsl });
    expect(mockSfnSend).toHaveBeenCalledTimes(3);
  });

  it("rejects unsupported intent-only input before SFN side effects", async () => {
    const { createRoutine } =
      await import("../graphql/resolvers/routines/createRoutine.mutation.js");

    await expect(
      createRoutine(
        null,
        {
          input: {
            tenantId: "tenant-a",
            name: "Slack alert",
            description: "Post a Slack message when a webhook fires.",
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/currently supports Austin weather/i);

    expect(mockValidate).not.toHaveBeenCalled();
    expect(mockSfnSend).not.toHaveBeenCalled();
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

    const { createRoutine } =
      await import("../graphql/resolvers/routines/createRoutine.mutation.js");

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

    const { createRoutine } =
      await import("../graphql/resolvers/routines/createRoutine.mutation.js");

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

    const { publishRoutineVersion } =
      await import("../graphql/resolvers/routines/publishRoutineVersion.mutation.js");

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
      errors: [{ code: "asl_syntax", message: "Missing Next on state X" }],
      warnings: [],
    });

    const { publishRoutineVersion } =
      await import("../graphql/resolvers/routines/publishRoutineVersion.mutation.js");

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

    const { publishRoutineVersion } =
      await import("../graphql/resolvers/routines/publishRoutineVersion.mutation.js");

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
// rebuildRoutineVersion
// ---------------------------------------------------------------------------

describe("rebuildRoutineVersion — server-authored ASL refresh", () => {
  it("rebuilds the persisted Austin weather intent and publishes through the shared version path", async () => {
    mockSelectRows
      .mockReturnValueOnce([
        {
          id: "routine-a",
          tenant_id: "tenant-a",
          name: "Check Austin Weather",
          description:
            "Check the weather in Austin and email it to ericodom37@gmail.com",
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
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        stateMachineVersionArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:2",
      })
      .mockResolvedValueOnce({});

    const { rebuildRoutineVersion } =
      await import("../graphql/resolvers/routines/rebuildRoutineVersion.mutation.js");

    const result = await rebuildRoutineVersion(
      null,
      { input: { routineId: "routine-a" } },
      ctx,
    );

    expect(mockRequireAdminOrApiKeyCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-a",
      "publish_routine_version",
    );
    expect(mockSfnSend).toHaveBeenCalledTimes(3);
    const updateInput = (mockSfnSend.mock.calls[0][0] as { input: any }).input;
    const updatedAsl = JSON.parse(updateInput.definition);
    expect(
      updatedAsl.States.FetchAustinWeather.Parameters.Payload,
    ).toMatchObject({
      "tenantId.$": "$$.Execution.Input.tenantId",
      "routineId.$": "$$.Execution.Input.routineId",
      "executionId.$": "$$.Execution.Id",
    });
    expect(
      updatedAsl.States.EmailAustinWeather.Parameters.Payload,
    ).toMatchObject({
      "tenantId.$": "$$.Execution.Input.tenantId",
      "routineId.$": "$$.Execution.Input.routineId",
      "executionId.$": "$$.Execution.Id",
      "body.$": "$.FetchAustinWeather.stdoutPreview",
    });
    const v = result as { versionNumber?: number; version_number?: number };
    expect(v.versionNumber ?? v.version_number).toBe(2);
  });

  it("returns the authoring error and skips SFN calls when the routine metadata cannot be rebuilt", async () => {
    mockSelectRows.mockReturnValueOnce([
      {
        id: "routine-a",
        tenant_id: "tenant-a",
        name: "Nightly digest",
        description: "Summarize new inbox items",
        engine: "step_functions",
        state_machine_arn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a",
        state_machine_alias_arn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:live",
        current_version: 1,
      },
    ]);

    const { rebuildRoutineVersion } =
      await import("../graphql/resolvers/routines/rebuildRoutineVersion.mutation.js");

    await expect(
      rebuildRoutineVersion(null, { input: { routineId: "routine-a" } }, ctx),
    ).rejects.toThrow(/Austin weather email routines/);

    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it("rejects rebuild on a legacy_python routine", async () => {
    mockSelectRows.mockReturnValueOnce([
      {
        id: "routine-legacy",
        tenant_id: "tenant-a",
        name: "Legacy routine",
        description:
          "Check the weather in Austin and email it to test@example.com",
        engine: "legacy_python",
        state_machine_arn: null,
        state_machine_alias_arn: null,
        current_version: null,
      },
    ]);

    const { rebuildRoutineVersion } =
      await import("../graphql/resolvers/routines/rebuildRoutineVersion.mutation.js");

    await expect(
      rebuildRoutineVersion(
        null,
        { input: { routineId: "routine-legacy" } },
        ctx,
      ),
    ).rejects.toThrow(/legacy/i);

    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// planRoutineDraft
// ---------------------------------------------------------------------------

describe("planRoutineDraft — recipe-backed pre-publish authoring", () => {
  it("returns the routine recipe catalog for workflow block picking", async () => {
    const { routineRecipeCatalog } =
      await import("../graphql/resolvers/routines/routineRecipeCatalog.query.js");

    const result = (await routineRecipeCatalog(
      null,
      { tenantId: "tenant-a" },
      ctx,
    )) as Array<{
      id: string;
      defaultArgs: Record<string, unknown>;
      configFields: Array<{ key: string; value: unknown }>;
    }>;

    expect(mockRequireAdminOrApiKeyCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-a",
      "create_routine",
    );
    expect(result.map((recipe) => recipe.id)).toContain("email_send");
    const email = result.find((recipe) => recipe.id === "email_send");
    expect(email?.defaultArgs).toMatchObject({ bodyFormat: "markdown" });
    expect(email?.configFields).toContainEqual(
      expect.objectContaining({ key: "to", value: [] }),
    );
  });

  it("returns a reviewable recipe draft without provisioning Step Functions resources", async () => {
    const { planRoutineDraft } =
      await import("../graphql/resolvers/routines/planRoutineDraft.mutation.js");

    const result = (await planRoutineDraft(
      null,
      {
        input: {
          tenantId: "tenant-a",
          name: "Check Austin Weather",
          description:
            "Check the weather in Austin and email it to ericodom37@gmail.com.",
        },
      },
      ctx,
    )) as {
      kind: string;
      steps: Array<{
        recipeId: string;
        configFields: Array<{ key: string; value: unknown; editable: boolean }>;
      }>;
      asl: unknown;
      stepManifest: unknown;
    };

    expect(mockRequireAdminOrApiKeyCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-a",
      "create_routine",
    );
    expect(mockSfnSend).not.toHaveBeenCalled();
    expect(result.kind).toBe("recipe_graph");
    expect(result.steps.map((step) => step.recipeId)).toEqual([
      "python",
      "email_send",
    ]);
    expect(result.steps[1]?.configFields).toContainEqual(
      expect.objectContaining({
        key: "to",
        value: ["ericodom37@gmail.com"],
        editable: true,
      }),
    );
    expect(JSON.stringify(result.asl)).toContain("email_send");
    expect(JSON.stringify(result.stepManifest)).toContain("recipe_graph");
  });

  it("rebuilds draft artifacts from editable step config", async () => {
    const { planRoutineDraft } =
      await import("../graphql/resolvers/routines/planRoutineDraft.mutation.js");

    const result = (await planRoutineDraft(
      null,
      {
        input: {
          tenantId: "tenant-a",
          name: "Check Austin Weather",
          description:
            "Check the weather in Austin and email it to old@example.com.",
          steps: [
            {
              nodeId: "EmailAustinWeather",
              args: {
                to: ["new@example.com"],
                subject: "Austin weather update - reviewed",
              },
            },
          ],
        },
      },
      ctx,
    )) as {
      steps: Array<{ configFields: Array<{ key: string; value: unknown }> }>;
      asl: unknown;
    };

    expect(mockSfnSend).not.toHaveBeenCalled();
    expect(JSON.stringify(result.asl)).toContain("new@example.com");
    expect(JSON.stringify(result.asl)).toContain(
      "Austin weather update - reviewed",
    );
    expect(result.steps[1]?.configFields).toContainEqual(
      expect.objectContaining({
        key: "subject",
        value: "Austin weather update - reviewed",
      }),
    );
  });

  it("builds draft artifacts from explicit recipe steps without an Austin-weather prompt", async () => {
    const { planRoutineDraft } =
      await import("../graphql/resolvers/routines/planRoutineDraft.mutation.js");

    const result = (await planRoutineDraft(
      null,
      {
        input: {
          tenantId: "tenant-a",
          name: "Manual workflow",
          description: "Send an operator email.",
          steps: [
            {
              nodeId: "SendEmail1",
              recipeId: "email_send",
              label: "Email operator",
              args: {
                to: ["ops@example.com"],
                subject: "Manual routine",
                body: "Hello from a manually assembled routine.",
                bodyFormat: "text",
              },
            },
          ],
        },
      },
      ctx,
    )) as {
      steps: Array<{ nodeId: string; recipeId: string; label: string }>;
      asl: unknown;
    };

    expect(mockSfnSend).not.toHaveBeenCalled();
    expect(result.steps).toEqual([
      expect.objectContaining({
        nodeId: "SendEmail1",
        recipeId: "email_send",
        label: "Email operator",
      }),
    ]);
    expect(JSON.stringify(result.asl)).toContain("ops@example.com");
  });

  it("rejects unsupported draft intents before side effects", async () => {
    const { planRoutineDraft } =
      await import("../graphql/resolvers/routines/planRoutineDraft.mutation.js");

    await expect(
      planRoutineDraft(
        null,
        {
          input: {
            tenantId: "tenant-a",
            name: "Post to Slack",
            description: "Post a message to Slack every morning.",
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/currently supports Austin weather email/i);

    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// routineDefinition / updateRoutineDefinition
// ---------------------------------------------------------------------------

describe("routineDefinition — editable product-owned definition", () => {
  it("returns the latest editable definition from the published ASL version", async () => {
    mockSelectRows
      .mockReturnValueOnce([
        {
          id: "routine-a",
          tenant_id: "tenant-a",
          name: "Check Austin Weather",
          description:
            "Check the weather in Austin and email it to ericodom37@gmail.com",
          engine: "step_functions",
          current_version: 3,
        },
      ])
      .mockReturnValueOnce([
        {
          id: "asl-v3",
          step_manifest_json: {
            definition: {
              kind: "weather_email",
              steps: [
                {
                  nodeId: "FetchAustinWeather",
                  recipeId: "python",
                  label: "Fetch Austin weather",
                  args: {
                    code: "print('weather')",
                    timeoutSeconds: 30,
                    networkAllowlist: ["wttr.in"],
                  },
                },
                {
                  nodeId: "EmailAustinWeather",
                  recipeId: "email_send",
                  label: "Email Austin weather",
                  args: {
                    to: ["ericodom37@gmail.com"],
                    subject: "Austin weather update",
                    bodyPath: "$.FetchAustinWeather.stdoutPreview",
                    bodyFormat: "markdown",
                  },
                },
              ],
            },
          },
          asl_json: minimalAsl,
        },
      ]);

    const { routineDefinition } =
      await import("../graphql/resolvers/routines/routineDefinition.query.js");

    const result = (await routineDefinition(
      null,
      { routineId: "routine-a" },
      ctx,
    )) as {
      currentVersion: number;
      versionId: string;
      steps: Array<{
        recipeId: string;
        configFields: Array<{ key: string; value: unknown }>;
      }>;
    };

    expect(mockRequireTenantMember).toHaveBeenCalledWith(ctx, "tenant-a");
    expect(result.currentVersion).toBe(3);
    expect(result.versionId).toBe("asl-v3");
    expect(result.steps[1]?.configFields).toContainEqual(
      expect.objectContaining({
        key: "to",
        value: ["ericodom37@gmail.com"],
      }),
    );
    expect(result.steps.map((step) => step.recipeId)).toEqual([
      "python",
      "email_send",
    ]);
  });

  it("publishes a new ASL version when an editable field changes", async () => {
    mockSelectRows
      .mockReturnValueOnce([
        {
          id: "routine-a",
          tenant_id: "tenant-a",
          name: "Check Austin Weather",
          description:
            "Check the weather in Austin and email it to old@example.com",
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
          id: "asl-v1",
          step_manifest_json: {
            definition: {
              kind: "weather_email",
              steps: [
                {
                  nodeId: "FetchAustinWeather",
                  recipeId: "python",
                  label: "Fetch Austin weather",
                  args: {
                    code: "print('weather')",
                    timeoutSeconds: 30,
                    networkAllowlist: ["wttr.in"],
                  },
                },
                {
                  nodeId: "EmailAustinWeather",
                  recipeId: "email_send",
                  label: "Email Austin weather",
                  args: {
                    to: ["old@example.com"],
                    subject: "Austin weather update",
                    bodyPath: "$.FetchAustinWeather.stdoutPreview",
                    bodyFormat: "markdown",
                  },
                },
              ],
            },
          },
          asl_json: minimalAsl,
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
      ])
      .mockReturnValueOnce([{ id: "routine-a", current_version: 2 }]);

    mockSfnSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        stateMachineVersionArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:2",
      })
      .mockResolvedValueOnce({});

    const { updateRoutineDefinition } =
      await import("../graphql/resolvers/routines/updateRoutineDefinition.mutation.js");

    const result = (await updateRoutineDefinition(
      null,
      {
        input: {
          routineId: "routine-a",
          steps: [
            {
              nodeId: "EmailAustinWeather",
              args: { to: ["new@example.com"] },
            },
          ],
        },
      },
      ctx,
    )) as {
      currentVersion: number;
      versionId: string;
      steps: Array<{ configFields: Array<{ key: string; value: unknown }> }>;
    };

    expect(mockRequireAdminOrApiKeyCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-a",
      "publish_routine_version",
    );
    expect(mockSfnSend).toHaveBeenCalledTimes(3);
    const updateInput = (mockSfnSend.mock.calls[0][0] as { input: any }).input;
    expect(updateInput.definition).toContain("new@example.com");
    expect(updateInput.definition).not.toContain("old@example.com");
    expect(result.currentVersion).toBe(2);
    expect(result.versionId).toBe("asl-v2");
    expect(result.steps[1]?.configFields).toContainEqual(
      expect.objectContaining({
        key: "to",
        value: ["new@example.com"],
      }),
    );
  });

  it("publishes a rebuilt ASL version when the ordered recipe graph changes", async () => {
    mockSelectRows
      .mockReturnValueOnce([
        {
          id: "routine-a",
          tenant_id: "tenant-a",
          name: "Check Austin Weather",
          description: "Check Austin weather.",
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
          id: "asl-v1",
          step_manifest_json: {
            definition: {
              kind: "recipe_graph",
              steps: [
                {
                  nodeId: "Wait1",
                  recipeId: "wait",
                  label: "Wait",
                  args: { seconds: 60 },
                },
              ],
            },
          },
          asl_json: minimalAsl,
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
      ])
      .mockReturnValueOnce([{ id: "routine-a", current_version: 2 }]);

    mockSfnSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        stateMachineVersionArn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:2",
      })
      .mockResolvedValueOnce({});

    const { updateRoutineDefinition } =
      await import("../graphql/resolvers/routines/updateRoutineDefinition.mutation.js");

    await updateRoutineDefinition(
      null,
      {
        input: {
          routineId: "routine-a",
          steps: [
            {
              nodeId: "SendEmail1",
              recipeId: "email_send",
              label: "Email operator",
              args: {
                to: ["ops@example.com"],
                subject: "Graph changed",
                body: "Workflow graph was edited.",
                bodyFormat: "text",
              },
            },
            {
              nodeId: "Wait1",
              recipeId: "wait",
              label: "Pause",
              args: { seconds: 120 },
            },
          ],
        },
      },
      ctx,
    );

    expect(mockSfnSend).toHaveBeenCalledTimes(3);
    const updateInput = (mockSfnSend.mock.calls[0][0] as { input: any }).input;
    expect(updateInput.definition).toContain("SendEmail1");
    expect(updateInput.definition).toContain("Wait1");
    expect(updateInput.definition.indexOf("SendEmail1")).toBeLessThan(
      updateInput.definition.indexOf("Wait1"),
    );
    expect(updateInput.definition).toContain("ops@example.com");
  });

  it("rejects invalid routine definition edits before SFN side effects", async () => {
    mockSelectRows
      .mockReturnValueOnce([
        {
          id: "routine-a",
          tenant_id: "tenant-a",
          name: "Check Austin Weather",
          description:
            "Check the weather in Austin and email it to old@example.com",
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
          id: "asl-v1",
          step_manifest_json: {
            definition: {
              kind: "weather_email",
              steps: [
                {
                  nodeId: "FetchAustinWeather",
                  recipeId: "python",
                  label: "Fetch Austin weather",
                  args: {
                    code: "print('weather')",
                    timeoutSeconds: 30,
                    networkAllowlist: ["wttr.in"],
                  },
                },
                {
                  nodeId: "EmailAustinWeather",
                  recipeId: "email_send",
                  label: "Email Austin weather",
                  args: {
                    to: ["old@example.com"],
                    subject: "Austin weather update",
                    bodyPath: "$.FetchAustinWeather.stdoutPreview",
                    bodyFormat: "markdown",
                  },
                },
              ],
            },
          },
          asl_json: minimalAsl,
        },
      ]);

    const { updateRoutineDefinition } =
      await import("../graphql/resolvers/routines/updateRoutineDefinition.mutation.js");

    await expect(
      updateRoutineDefinition(
        null,
        {
          input: {
            routineId: "routine-a",
            steps: [
              {
                nodeId: "EmailAustinWeather",
                args: { to: ["not-an-email"] },
              },
            ],
          },
        },
        ctx,
      ),
    ).rejects.toThrow(/valid email addresses/i);

    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// triggerRoutineRun
// ---------------------------------------------------------------------------

describe("triggerRoutineRun — SFN.StartExecution swap", () => {
  it("calls SFN StartExecution against the captured version ARN and inserts a routine_executions row", async () => {
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
          current_version: 3,
        },
      ])
      .mockReturnValueOnce([
        {
          id: "asl-version-3",
          routine_id: "routine-a",
          version_number: 3,
          version_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:3",
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

    const { triggerRoutineRun } =
      await import("../graphql/resolvers/routines/triggerRoutineRun.mutation.js");

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
      input: { stateMachineArn: string; input: string };
    };
    expect(startCall.input.stateMachineArn).toBe(
      "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:3",
    );
    expect(JSON.parse(startCall.input.input)).toMatchObject({
      tenantId: "tenant-a",
      routineId: "routine-a",
      inboxApprovalFunctionName: "thinkwork-dev-api-routine-approval-callback",
      emailSendFunctionName: "thinkwork-dev-api-email-send",
      routineTaskPythonFunctionName: "thinkwork-dev-api-routine-task-python",
      adminOpsMcpFunctionName: "thinkwork-dev-api-admin-ops-mcp",
      slackSendFunctionName: "thinkwork-dev-api-slack-send",
    });
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        version_arn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:3",
        routine_asl_version_id: "asl-version-3",
      }),
    );
    expect((result as { status: string }).status).toBe("running");
  });

  it("server-owned runtime names override caller-supplied execution input", async () => {
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
          current_version: 3,
        },
      ])
      .mockReturnValueOnce([
        {
          id: "asl-version-3",
          routine_id: "routine-a",
          version_number: 3,
          version_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:3",
        },
      ])
      .mockReturnValueOnce([{ id: "exec-row-1", status: "running" }]);
    mockSfnSend.mockResolvedValueOnce({
      executionArn:
        "arn:aws:states:us-east-1:123456789012:execution:thinkwork-dev-routine-routine-a:exec-1",
      startDate: new Date(),
    });

    const { triggerRoutineRun } =
      await import("../graphql/resolvers/routines/triggerRoutineRun.mutation.js");

    await triggerRoutineRun(
      null,
      {
        routineId: "routine-a",
        input: {
          tenantId: "attacker-tenant",
          routineId: "attacker-routine",
          emailSendFunctionName: "attacker-controlled",
        },
      },
      ctx,
    );

    const startCall = mockSfnSend.mock.calls[0][0] as {
      input: { input: string };
    };
    expect(JSON.parse(startCall.input.input).emailSendFunctionName).toBe(
      "thinkwork-dev-api-email-send",
    );
    expect(JSON.parse(startCall.input.input)).toMatchObject({
      tenantId: "tenant-a",
      routineId: "routine-a",
    });
  });

  it("rejects before SFN when the routine has no current ASL version", async () => {
    mockSelectRows.mockReturnValueOnce([
      {
        id: "routine-a",
        tenant_id: "tenant-a",
        engine: "step_functions",
        state_machine_arn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a",
        state_machine_alias_arn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:live",
        current_version: null,
      },
    ]);

    const { triggerRoutineRun } =
      await import("../graphql/resolvers/routines/triggerRoutineRun.mutation.js");

    await expect(
      triggerRoutineRun(null, { routineId: "routine-a" }, ctx),
    ).rejects.toThrow(/no current ASL version/i);

    expect(mockSfnSend).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("rejects before SFN when the current ASL version row is missing", async () => {
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
          current_version: 3,
        },
      ])
      .mockReturnValueOnce([]);

    const { triggerRoutineRun } =
      await import("../graphql/resolvers/routines/triggerRoutineRun.mutation.js");

    await expect(
      triggerRoutineRun(null, { routineId: "routine-a" }, ctx),
    ).rejects.toThrow(/current ASL version 3 was not found/i);

    expect(mockSfnSend).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("rejects before SFN when migration 0061 has not added the execution version column", async () => {
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
          current_version: 3,
        },
      ])
      .mockReturnValueOnce([
        {
          id: "asl-version-3",
          routine_id: "routine-a",
          version_number: 3,
          version_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:thinkwork-dev-routine-routine-a:3",
        },
      ]);
    mockExecuteRows.mockReturnValueOnce([]);

    const { triggerRoutineRun } =
      await import("../graphql/resolvers/routines/triggerRoutineRun.mutation.js");

    await expect(
      triggerRoutineRun(null, { routineId: "routine-a" }, ctx),
    ).rejects.toThrow(/migration 0061/i);

    expect(mockSfnSend).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
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

    const { triggerRoutineRun } =
      await import("../graphql/resolvers/routines/triggerRoutineRun.mutation.js");

    await expect(
      triggerRoutineRun(null, { routineId: "routine-legacy" }, ctx),
    ).rejects.toThrow(/legacy_python/i);

    expect(mockSfnSend).not.toHaveBeenCalled();
  });
});
