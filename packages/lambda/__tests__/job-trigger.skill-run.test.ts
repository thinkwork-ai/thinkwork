/**
 * Tests for the skill_run branch in packages/lambda/job-trigger.ts (Unit 6).
 *
 * Scenarios covered (per plan):
 *   * happy path: fires → skill_runs row inserted → AgentCore invoked
 *   * skill disabled → skipped_disabled row, no invoke
 *   * invoker deprovisioned → scheduled_jobs.enabled=false, no row
 *   * invalid binding → failed row with invalid_binding reason, no invoke
 *   * dedup hit: INSERT returns zero rows → no invoke
 *   * binding resolver: from_tenant_config / today_plus_N / literal / plain
 *
 * DB + Lambda client mocked at the module boundary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockSelect,
  mockInsert,
  mockInsertValues,
  mockUpdate,
  mockUpdateSet,
  mockEnsureThreadForWork,
  mockLambdaSend,
  mockSfnSend,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockInsertValues: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateSet: vi.fn(),
  mockEnsureThreadForWork: vi.fn(),
  mockLambdaSend: vi.fn(),
  mockSfnSend: vi.fn(),
}));

// Rows returned by `db.select().from().where()` — routed by a tag the caller
// sets via mockSelect.mockReturnValueOnce({ tag, rows }).
type Rows = Record<string, unknown>[];

const selectChain = (rows: Rows) => ({
  from: () => ({
    where: () => {
      const resolved = Promise.resolve(rows);
      return {
        limit: () => resolved,
        then: (
          resolve: (value: Rows) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => resolved.then(resolve, reject),
      };
    },
  }),
});

const insertChain = (rows: Rows) => ({
  values: (value: Record<string, unknown>) => {
    mockInsertValues(value);
    return {
      returning: () => Promise.resolve(rows),
      onConflictDoNothing: () => ({
        returning: () => Promise.resolve(rows),
      }),
    };
  },
});

const updateChain = () => ({
  set: (value: Record<string, unknown>) => {
    mockUpdateSet(value);
    return {
      where: () => Promise.resolve(),
      returning: () => Promise.resolve([]),
    };
  },
});

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => selectChain((mockSelect() as Rows) ?? []),
    insert: () => insertChain((mockInsert() as Rows) ?? []),
    update: () => {
      mockUpdate();
      return updateChain();
    },
  }),
  ensureThreadForWork: mockEnsureThreadForWork,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agentWakeupRequests: { id: "agent_wakeup_requests.id" },
  agentLoops: {
    id: "agent_loops.id",
    tenant_id: "agent_loops.tenant_id",
    name: "agent_loops.name",
    enabled: "agent_loops.enabled",
    lifecycle_status: "agent_loops.lifecycle_status",
    current_version_id: "agent_loops.current_version_id",
    space_id: "agent_loops.space_id",
    last_run_id: "agent_loops.last_run_id",
    last_run_status: "agent_loops.last_run_status",
    last_run_at: "agent_loops.last_run_at",
    last_run_summary: "agent_loops.last_run_summary",
    updated_at: "agent_loops.updated_at",
  },
  agentLoopVersions: {
    id: "agent_loop_versions.id",
    version_status: "agent_loop_versions.version_status",
    goal_spec: "agent_loop_versions.goal_spec",
    worker_spec: "agent_loop_versions.worker_spec",
    judge_spec: "agent_loop_versions.judge_spec",
    loop_policy: "agent_loop_versions.loop_policy",
  },
  agentLoopRuns: {
    id: "agent_loop_runs.id",
    tenant_id: "agent_loop_runs.tenant_id",
    agent_loop_id: "agent_loop_runs.agent_loop_id",
    agent_loop_version_id: "agent_loop_runs.agent_loop_version_id",
    status: "agent_loop_runs.status",
    idempotency_key: "agent_loop_runs.idempotency_key",
  },
  agentLoopIterations: {
    id: "agent_loop_iterations.id",
  },
  agents: { id: "agents.id", runtime_config: "agents.runtime_config" },
  spaces: {
    id: "spaces.id",
    tenant_id: "spaces.tenant_id",
    status: "spaces.status",
  },
  agentSkills: {
    id: "agent_skills.id",
    agent_id: "agent_skills.agent_id",
    skill_id: "agent_skills.skill_id",
    enabled: "agent_skills.enabled",
  },
  budgetPolicies: {
    tenant_id: "budget_policies.tenant_id",
    scope: "budget_policies.scope",
    user_id: "budget_policies.user_id",
    enabled: "budget_policies.enabled",
    limit_usd: "budget_policies.limit_usd",
  },
  costEvents: {
    tenant_id: "cost_events.tenant_id",
    user_id: "cost_events.user_id",
    created_at: "cost_events.created_at",
  },
  evalRuns: { id: "eval_runs.id" },
  routineAslVersions: {
    id: "routine_asl_versions.id",
    tenant_id: "routine_asl_versions.tenant_id",
    routine_id: "routine_asl_versions.routine_id",
    version_number: "routine_asl_versions.version_number",
    state_machine_arn: "routine_asl_versions.state_machine_arn",
    version_arn: "routine_asl_versions.version_arn",
    asl_json: "routine_asl_versions.asl_json",
    markdown_summary: "routine_asl_versions.markdown_summary",
    step_manifest_json: "routine_asl_versions.step_manifest_json",
    published_by_actor_type: "routine_asl_versions.published_by_actor_type",
    published_by_actor_id: "routine_asl_versions.published_by_actor_id",
    created_at: "routine_asl_versions.created_at",
  },
  routineExecutions: {
    id: "routine_executions.id",
    tenant_id: "routine_executions.tenant_id",
    routine_id: "routine_executions.routine_id",
    state_machine_arn: "routine_executions.state_machine_arn",
    alias_arn: "routine_executions.alias_arn",
    version_arn: "routine_executions.version_arn",
    routine_asl_version_id: "routine_executions.routine_asl_version_id",
    sfn_execution_arn: "routine_executions.sfn_execution_arn",
    trigger_id: "routine_executions.trigger_id",
    trigger_source: "routine_executions.trigger_source",
  },
  routines: {
    id: "routines.id",
    tenant_id: "routines.tenant_id",
    name: "routines.name",
    description: "routines.description",
    engine: "routines.engine",
    status: "routines.status",
    visibility: "routines.visibility",
    agent_id: "routines.agent_id",
    owning_agent_id: "routines.owning_agent_id",
    state_machine_arn: "routines.state_machine_arn",
    state_machine_alias_arn: "routines.state_machine_alias_arn",
    current_version: "routines.current_version",
  },
  computers: {
    id: "computers.id",
    tenant_id: "computers.tenant_id",
    owner_user_id: "computers.owner_user_id",
    runtime_status: "computers.runtime_status",
    primary_agent_id: "computers.primary_agent_id",
    migrated_from_agent_id: "computers.migrated_from_agent_id",
    status: "computers.status",
  },
  computerEvents: {
    id: "computer_events.id",
  },
  computerTasks: {
    id: "computer_tasks.id",
    tenant_id: "computer_tasks.tenant_id",
    computer_id: "computer_tasks.computer_id",
    idempotency_key: "computer_tasks.idempotency_key",
  },
  messages: {
    id: "messages.id",
  },
  scheduledJobs: {
    id: "scheduled_jobs.id",
    tenant_id: "scheduled_jobs.tenant_id",
    enabled: "scheduled_jobs.enabled",
    budget_paused: "scheduled_jobs.budget_paused",
    budget_paused_at: "scheduled_jobs.budget_paused_at",
    budget_paused_reason: "scheduled_jobs.budget_paused_reason",
    name: "scheduled_jobs.name",
    agent_id: "scheduled_jobs.agent_id",
    agent_loop_id: "scheduled_jobs.agent_loop_id",
    space_id: "scheduled_jobs.space_id",
    prompt: "scheduled_jobs.prompt",
    config: "scheduled_jobs.config",
    created_by_type: "scheduled_jobs.created_by_type",
    created_by_id: "scheduled_jobs.created_by_id",
    last_run_at: "scheduled_jobs.last_run_at",
    updated_at: "scheduled_jobs.updated_at",
  },
  skillRuns: {
    id: "skill_runs.id",
    tenant_id: "skill_runs.tenant_id",
    invoker_user_id: "skill_runs.invoker_user_id",
    skill_id: "skill_runs.skill_id",
    resolved_inputs_hash: "skill_runs.resolved_inputs_hash",
  },
  tenantSettings: {
    tenant_id: "tenant_settings.tenant_id",
    features: "tenant_settings.features",
  },
  threadIdleLearningState: {
    id: "thread_idle_learning_state.id",
    tenant_id: "thread_idle_learning_state.tenant_id",
    thread_id: "thread_idle_learning_state.thread_id",
    computer_id: "thread_idle_learning_state.computer_id",
    requester_user_id: "thread_idle_learning_state.requester_user_id",
    activity_sequence: "thread_idle_learning_state.activity_sequence",
    last_activity_at: "thread_idle_learning_state.last_activity_at",
    scheduled_for: "thread_idle_learning_state.scheduled_for",
    scheduled_job_id: "thread_idle_learning_state.scheduled_job_id",
  },
  threadIdleLearningRuns: {
    id: "thread_idle_learning_runs.id",
  },
  threadTurns: { id: "thread_turns.id" },
  workflowEngineBindings: {
    id: "workflow_engine_bindings.id",
    tenant_id: "workflow_engine_bindings.tenant_id",
    workflow_id: "workflow_engine_bindings.workflow_id",
    workflow_version_id: "workflow_engine_bindings.workflow_version_id",
    routine_id: "workflow_engine_bindings.routine_id",
    routine_asl_version_id: "workflow_engine_bindings.routine_asl_version_id",
  },
  workflowEvidence: {
    id: "workflow_evidence.id",
  },
  workflowRuns: {
    id: "workflow_runs.id",
    tenant_id: "workflow_runs.tenant_id",
    workflow_id: "workflow_runs.workflow_id",
    workflow_version_id: "workflow_runs.workflow_version_id",
    engine_binding_id: "workflow_runs.engine_binding_id",
  },
  workflowTriggers: {
    id: "workflow_triggers.id",
    workflow_id: "workflow_triggers.workflow_id",
    trigger_family: "workflow_triggers.trigger_family",
  },
  workflowVersions: {
    id: "workflow_versions.id",
    workflow_id: "workflow_versions.workflow_id",
    version_number: "workflow_versions.version_number",
  },
  workflows: {
    id: "workflows.id",
  },
  users: {
    id: "users.id",
    tenant_id: "users.tenant_id",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
  gte: (...args: unknown[]) => ({ _gte: args }),
  sql: (...args: unknown[]) => ({ _sql: args }),
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({ send: mockLambdaSend })),
  InvokeCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

vi.mock("@aws-sdk/client-sfn", () => ({
  SFNClient: vi.fn().mockImplementation(() => ({ send: mockSfnSend })),
  StartExecutionCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

// After mocks — import the handler + exported pure helpers.
import {
  buildRoutineExecutionInput,
  handler,
  resolveInputBindings,
} from "../job-trigger.js";

const BASE_EVENT = {
  triggerId: "job-1",
  triggerType: "skill_run",
  tenantId: "T1",
  scheduleName: "thinkwork-T1-sales-prep-daily",
};

const JOB_CONFIG = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  skillId: "sales-prep",
  invokerUserId: "U1",
  agentId: "A1",
  inputBindings: {
    customer: "ABC Fuels",
    meeting_date: { today_plus_N: 1 },
  },
  ...overrides,
});

const pushJobLookup = (
  config: Record<string, unknown> = JOB_CONFIG(),
): void => {
  // 1st select: fetch scheduledJobs row — the handler always runs this.
  mockSelect.mockReturnValueOnce([
    { enabled: true, budget_paused: false, name: "Sales prep daily", config },
  ]);
  if (typeof config.invokerUserId === "string" && config.invokerUserId) {
    mockSelect.mockReturnValueOnce([{ id: config.invokerUserId }]);
    mockSelect.mockReturnValueOnce([]);
  }
};

const pushInvokerLookup = (found: boolean): void => {
  mockSelect.mockReturnValueOnce(found ? [{ id: "U1" }] : []);
};

const pushTenantSettings = (
  features: Record<string, unknown> | null = {},
): void => {
  mockSelect.mockReturnValueOnce([{ features }]);
};

const pushAgentSkillEnablement = (enabled: boolean | null): void => {
  mockSelect.mockReturnValueOnce(enabled === null ? [] : [{ enabled }]);
};

const AGENT_LOOP_JOB = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  enabled: true,
  budget_paused: false,
  budget_paused_reason: null,
  name: "Daily research loop",
  agent_id: "agent-1",
  agent_loop_id: "loop-1",
  space_id: "scheduled-space-1",
  prompt: "Prepare the daily research brief.",
  config: { product: "agent_loop" },
  created_by_type: "system",
  created_by_id: null,
  ...overrides,
});

const AGENT_LOOP_ROW = {
  id: "loop-1",
  tenant_id: "T1",
  name: "Daily research loop",
  enabled: true,
  lifecycle_status: "active",
  current_version_id: "version-1",
  space_id: "loop-space-1",
};

const AGENT_LOOP_VERSION_ROW = {
  id: "version-1",
  version_status: "active",
  goal_spec: {
    objective: "Prepare the daily research brief.",
    completionCriteria: ["Brief exists."],
  },
  worker_spec: {
    type: "agent",
    id: "agent-1",
    toolHints: [],
    config: {},
  },
  judge_spec: {
    mode: "self_check",
    criteria: [],
    config: {},
  },
  loop_policy: {
    maxIterations: 1,
    maxTokens: 50_000,
    failBehavior: "return_blocker",
    escalateOnFailure: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENTCORE_FUNCTION_NAME = "thinkwork-dev-api-agentcore-invoke";
  process.env.THREAD_IDLE_MEMORY_LEARNING_FUNCTION_NAME =
    "thinkwork-dev-api-thread-idle-memory-learning";
  process.env.ROUTINE_APPROVAL_CALLBACK_FUNCTION_NAME =
    "thinkwork-dev-api-routine-approval-callback";
  process.env.EMAIL_SEND_FUNCTION_NAME = "thinkwork-dev-api-email-send";
  process.env.ROUTINE_TASK_PYTHON_FUNCTION_NAME =
    "thinkwork-dev-api-routine-task-python";
  process.env.ADMIN_OPS_MCP_FUNCTION_NAME = "thinkwork-dev-api-admin-ops-mcp";
  process.env.SLACK_SEND_FUNCTION_NAME = "thinkwork-dev-api-slack-send";
  mockLambdaSend.mockResolvedValue({
    FunctionError: undefined,
    Payload: undefined,
  });
  mockEnsureThreadForWork.mockResolvedValue({
    threadId: "thread-1",
    identifier: "AUTO-1",
    number: 1,
  });
});

describe("job-trigger agent_loop_schedule", () => {
  it("creates a run, first iteration, and agent_loop wakeup", async () => {
    mockSelect
      .mockReturnValueOnce([AGENT_LOOP_JOB()])
      .mockReturnValueOnce([AGENT_LOOP_ROW])
      .mockReturnValueOnce([AGENT_LOOP_VERSION_ROW])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: "loop-space-1" }]);
    mockInsert
      .mockReturnValueOnce([{ id: "run-1", status: "queued" }])
      .mockReturnValueOnce([{ id: "iteration-1" }])
      .mockReturnValueOnce([{ id: "wakeup-1" }]);

    await handler({
      triggerId: "job-loop-1",
      triggerType: "agent_loop_schedule",
      tenantId: "T1",
      scheduleName: "thinkwork-dev-loop-daily",
      scheduledTime: "2026-06-22T12:00:00.000Z",
    });

    expect(mockInsertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tenant_id: "T1",
        agent_loop_id: "loop-1",
        agent_loop_version_id: "version-1",
        status: "queued",
        trigger_family: "schedule",
        trigger_source: "agent_loop_schedule",
        scheduled_job_id: "job-loop-1",
        idempotency_key:
          "agent_loop_schedule:job-loop-1:2026-06-22T12:00:00.000Z",
        current_iteration: 1,
      }),
    );
    expect(mockInsertValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tenant_id: "T1",
        agent_loop_run_id: "run-1",
        iteration_number: 1,
        status: "queued",
        goal_mode_action: "start",
      }),
    );
    expect(mockInsertValues).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        tenant_id: "T1",
        agent_id: "agent-1",
        source: "agent_loop",
        idempotency_key: "agent-loop:run-1:iteration:1",
        payload: expect.objectContaining({
          threadId: "thread-1",
          spaceId: "loop-space-1",
          goalMode: expect.objectContaining({
            action: "start",
            goalRunId: "run-1",
            resolvedBudget: { tokenBudget: 50_000 },
          }),
          agentLoop: expect.objectContaining({
            loopId: "loop-1",
            runId: "run-1",
            iterationId: "iteration-1",
            versionId: "version-1",
          }),
        }),
      }),
    );
    expect(mockEnsureThreadForWork).toHaveBeenCalledWith({
      tenantId: "T1",
      agentId: "agent-1",
      userId: undefined,
      spaceId: "loop-space-1",
      title: "Automation: Daily research loop",
      channel: "schedule",
    });
  });

  it("reuses an existing scheduled run for the same fire id", async () => {
    mockSelect
      .mockReturnValueOnce([AGENT_LOOP_JOB()])
      .mockReturnValueOnce([AGENT_LOOP_ROW])
      .mockReturnValueOnce([AGENT_LOOP_VERSION_ROW])
      .mockReturnValueOnce([{ id: "run-existing", status: "queued" }]);

    await handler({
      triggerId: "job-loop-1",
      triggerType: "agent_loop_schedule",
      tenantId: "T1",
      fireId: "fire-1",
    });

    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("records a skipped run when the schedule is budget paused", async () => {
    mockSelect
      .mockReturnValueOnce([
        AGENT_LOOP_JOB({
          budget_paused: true,
          budget_paused_reason: "User budget exceeded.",
        }),
      ])
      .mockReturnValueOnce([AGENT_LOOP_ROW])
      .mockReturnValueOnce([AGENT_LOOP_VERSION_ROW])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: "loop-space-1" }]);
    mockInsert
      .mockReturnValueOnce([{ id: "run-1", status: "skipped" }])
      .mockReturnValueOnce([{ id: "iteration-1" }]);

    await handler({
      triggerId: "job-loop-1",
      triggerType: "agent_loop_schedule",
      tenantId: "T1",
      fireId: "fire-1",
    });

    expect(mockInsertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        status: "skipped",
        error_code: "schedule_budget_paused",
        error_message: "User budget exceeded.",
      }),
    );
    expect(mockInsertValues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: "skipped",
        error_code: "schedule_budget_paused",
      }),
    );
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Routine execution input helper (pure function)
// ---------------------------------------------------------------------------

describe("buildRoutineExecutionInput", () => {
  it("adds server-owned routine recipe function names and overrides caller values", () => {
    const input = buildRoutineExecutionInput(
      {
        emailSendFunctionName: "caller-controlled",
        tenantId: "caller-tenant",
        routineId: "caller-routine",
        agentId: "agent-a",
        spaceId: "space-a",
        customValue: "kept",
      },
      {
        tenantId: "tenant-a",
        routineId: "routine-a",
      },
    );

    expect(input).toMatchObject({
      customValue: "kept",
      tenantId: "tenant-a",
      routineId: "routine-a",
      agentId: "agent-a",
      spaceId: "space-a",
      inboxApprovalFunctionName: "thinkwork-dev-api-routine-approval-callback",
      emailSendFunctionName: "thinkwork-dev-api-email-send",
      routineTaskPythonFunctionName: "thinkwork-dev-api-routine-task-python",
      adminOpsMcpFunctionName: "thinkwork-dev-api-admin-ops-mcp",
      slackSendFunctionName: "thinkwork-dev-api-slack-send",
    });
  });

  it("keeps email recipe JSONPath fields present when no Space context exists", () => {
    const input = buildRoutineExecutionInput(
      {
        agentId: 42,
      },
      {
        tenantId: "tenant-a",
        routineId: "routine-a",
      },
    );

    expect(input.agentId).toBeNull();
    expect(input.spaceId).toBeNull();
  });
});

describe("job-trigger routine_schedule", () => {
  it("starts the captured ASL version ARN and records workflow run correlation", async () => {
    const startDate = new Date("2026-06-20T16:00:00Z");
    mockSelect
      .mockReturnValueOnce([
        {
          enabled: true,
          budget_paused: false,
          name: "Daily routine",
          agent_id: "agent-1",
          space_id: "space-1",
          config: {},
        },
      ])
      .mockReturnValueOnce([
        {
          id: "routine-1",
          tenant_id: "tenant-1",
          name: "Daily email digest",
          description: "Send a digest",
          engine: "step_functions",
          status: "active",
          visibility: "tenant_shared",
          agent_id: "agent-1",
          owning_agent_id: null,
          state_machine_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1",
          state_machine_alias_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1:live",
          current_version: 7,
        },
      ])
      .mockReturnValueOnce([
        {
          id: "asl-version-7",
          version_number: 7,
          state_machine_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1",
          version_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1:7",
          asl_json: { StartAt: "A", States: { A: { Type: "Succeed" } } },
          markdown_summary: "A",
          step_manifest_json: [],
          published_by_actor_type: "user",
          published_by_actor_id: "user-1",
          created_at: startDate,
        },
      ])
      .mockReturnValueOnce([]) // existing workflow binding
      .mockReturnValueOnce([]) // existing workflow version
      .mockReturnValueOnce([]); // existing schedule trigger
    mockInsert
      .mockReturnValueOnce([{ id: "workflow-1" }])
      .mockReturnValueOnce([{ id: "workflow-version-7" }])
      .mockReturnValueOnce([{ id: "binding-1" }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: "routine-execution-1" }])
      .mockReturnValueOnce([{ id: "workflow-run-1" }])
      .mockReturnValueOnce([]);
    mockSfnSend.mockResolvedValueOnce({
      executionArn:
        "arn:aws:states:us-east-1:123456789012:execution:routine-1:exec-1",
      startDate,
    });

    await handler({
      triggerId: "job-1",
      triggerType: "routine_schedule",
      tenantId: "tenant-1",
      routineId: "routine-1",
      scheduleName: "daily-routine",
    } as never);

    const startCall = mockSfnSend.mock.calls[0]![0] as {
      input: { stateMachineArn: string; input: string };
    };
    expect(startCall.input.stateMachineArn).toBe(
      "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1:7",
    );
    expect(JSON.parse(startCall.input.input)).toMatchObject({
      tenantId: "tenant-1",
      routineId: "routine-1",
      triggerSource: "schedule",
      scheduleName: "daily-routine",
    });
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        version_arn:
          "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1:7",
        routine_asl_version_id: "asl-version-7",
      }),
    );
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: "workflow-1",
        workflow_version_id: "workflow-version-7",
        engine_binding_id: "binding-1",
        backend_execution_id:
          "arn:aws:states:us-east-1:123456789012:execution:routine-1:exec-1",
      }),
    );
  });

  it("refreshes existing workflow binding and trigger rows when the routine version advances", async () => {
    const startDate = new Date("2026-06-20T17:00:00Z");
    mockSelect
      .mockReturnValueOnce([
        {
          enabled: true,
          budget_paused: false,
          name: "Daily routine",
          agent_id: "agent-1",
          space_id: "space-1",
          config: {},
        },
      ])
      .mockReturnValueOnce([
        {
          id: "routine-1",
          tenant_id: "tenant-1",
          name: "Daily email digest",
          description: "Send a digest",
          engine: "step_functions",
          status: "active",
          visibility: "tenant_shared",
          agent_id: "agent-1",
          owning_agent_id: null,
          state_machine_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1",
          state_machine_alias_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1:live",
          current_version: 8,
        },
      ])
      .mockReturnValueOnce([
        {
          id: "asl-version-8",
          version_number: 8,
          state_machine_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1",
          version_arn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1:8",
          asl_json: { StartAt: "A", States: { A: { Type: "Succeed" } } },
          markdown_summary: "A",
          step_manifest_json: [],
          published_by_actor_type: "user",
          published_by_actor_id: "user-1",
          created_at: startDate,
        },
      ])
      .mockReturnValueOnce([
        {
          id: "binding-1",
          workflow_id: "workflow-1",
          workflow_version_id: "workflow-version-7",
        },
      ])
      .mockReturnValueOnce([{ id: "workflow-version-8" }])
      .mockReturnValueOnce([{ id: "trigger-1" }]);
    mockInsert
      .mockReturnValueOnce([{ id: "routine-execution-8" }])
      .mockReturnValueOnce([{ id: "workflow-run-8" }])
      .mockReturnValueOnce([]);
    mockSfnSend.mockResolvedValueOnce({
      executionArn:
        "arn:aws:states:us-east-1:123456789012:execution:routine-1:exec-8",
      startDate,
    });

    await handler({
      triggerId: "job-1",
      triggerType: "routine_schedule",
      tenantId: "tenant-1",
      routineId: "routine-1",
      scheduleName: "daily-routine",
    } as never);

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_version_id: "workflow-version-8",
        routine_asl_version_id: "asl-version-8",
        external_version_id: "8",
        connection_ref: expect.objectContaining({
          aliasArn:
            "arn:aws:states:us-east-1:123456789012:stateMachine:routine-1:live",
        }),
      }),
    );
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_version_id: "workflow-version-8",
        enabled: true,
        trigger_config: { routineId: "routine-1" },
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Binding resolver (pure function)
// ---------------------------------------------------------------------------

describe("resolveInputBindings", () => {
  it("returns literal plain values unchanged", async () => {
    const out = await resolveInputBindings(
      { a: "hello", b: 42, c: true, d: null },
      { tenantId: "T", tenantSettingsBlob: {}, now: new Date() },
    );
    expect(out).toEqual({
      ok: true,
      resolved: { a: "hello", b: 42, c: true, d: null },
    });
  });

  it("resolves { literal: X } envelopes", async () => {
    const out = await resolveInputBindings(
      { x: { literal: { nested: 1 } } },
      { tenantId: "T", tenantSettingsBlob: {}, now: new Date() },
    );
    expect(
      (out as { ok: true; resolved: Record<string, unknown> }).resolved.x,
    ).toEqual({ nested: 1 });
  });

  it("pulls from_tenant_config from the settings blob", async () => {
    const out = await resolveInputBindings(
      { customer: { from_tenant_config: "default_customer" } },
      {
        tenantId: "T",
        tenantSettingsBlob: { default_customer: "ABC" },
        now: new Date(),
      },
    );
    expect(out).toEqual({ ok: true, resolved: { customer: "ABC" } });
  });

  it("surfaces missing from_tenant_config keys", async () => {
    const out = await resolveInputBindings(
      { customer: { from_tenant_config: "missing_key" } },
      { tenantId: "T", tenantSettingsBlob: {}, now: new Date() },
    );
    expect(out.ok).toBe(false);
    expect((out as { ok: false; missing: string[] }).missing).toEqual([
      "customer: from_tenant_config=missing_key",
    ]);
  });

  it("renders today_plus_N as ISO date string", async () => {
    const now = new Date("2026-05-01T00:00:00Z");
    const out = await resolveInputBindings(
      {
        d0: { today_plus_N: 0 },
        d1: { today_plus_N: 1 },
        d7: { today_plus_N: 7 },
      },
      { tenantId: "T", tenantSettingsBlob: {}, now },
    );
    expect(out).toEqual({
      ok: true,
      resolved: { d0: "2026-05-01", d1: "2026-05-02", d7: "2026-05-08" },
    });
  });

  it("rejects unknown binding shapes", async () => {
    // Deliberately passing an unknown envelope shape — testing the guard.
    const bindings = {
      x: { some_future_binding: "y" },
    } as unknown as Parameters<typeof resolveInputBindings>[0];
    const out = await resolveInputBindings(bindings, {
      tenantId: "T",
      tenantSettingsBlob: {},
      now: new Date(),
    });
    expect(out.ok).toBe(false);
    expect((out as { ok: false; missing: string[] }).missing[0]).toMatch(
      /unknown binding shape/,
    );
  });
});

// ---------------------------------------------------------------------------
// handler — skill_run branch
// ---------------------------------------------------------------------------

describe("job-trigger skill_run happy path", () => {
  it("inserts a running skill_runs row and invokes agentcore-invoke", async () => {
    pushJobLookup();
    pushInvokerLookup(true);
    pushTenantSettings({});
    pushAgentSkillEnablement(true);
    // INSERT returns the new row
    mockInsert.mockReturnValueOnce([
      {
        id: "run-1",
        skill_version: 1,
      },
    ]);

    await handler(BASE_EVENT as never);

    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    const cmd = mockLambdaSend.mock.calls[0]![0] as {
      input: { FunctionName: string; Payload: Uint8Array };
    };
    const payload = JSON.parse(new TextDecoder().decode(cmd.input.Payload));
    expect(payload.body).toBeDefined();
    const envelope = JSON.parse(payload.body);
    expect(envelope.kind).toBe("run_skill");
    expect(envelope.runId).toBe("run-1");
    expect(envelope.tenantId).toBe("T1");
    expect(envelope.invokerUserId).toBe("U1");
    expect(envelope.invocationSource).toBe("scheduled");
    // Regression pin for P0: agentId must flow through; Python
    // dispatcher rejects null-agent envelopes with
    // _MISSING_AGENT_REASON and the scheduled path would go dark.
    expect(envelope.agentId).toBe("A1");
    expect(envelope.resolvedInputs.customer).toBe("ABC Fuels");
    expect(envelope.resolvedInputs.meeting_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // U4 contract — must stay asynchronous so the agent loop has the
    // full 900s AgentCore Lambda budget.
    expect(cmd.input).toMatchObject({ InvocationType: "Event" });
  });
});

describe("job-trigger skill_run skill-disabled path", () => {
  it("writes skipped_disabled row and does not invoke", async () => {
    pushJobLookup();
    pushInvokerLookup(true);
    pushTenantSettings({});
    pushAgentSkillEnablement(false);
    mockInsert.mockReturnValueOnce([]);

    await handler(BASE_EVENT as never);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("writes skipped_disabled row when agent_skills row is absent", async () => {
    pushJobLookup();
    pushInvokerLookup(true);
    pushTenantSettings({});
    pushAgentSkillEnablement(null);
    mockInsert.mockReturnValueOnce([]);

    await handler(BASE_EVENT as never);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

describe("job-trigger skill_run deprovisioned path", () => {
  it("pauses the scheduled job and does not insert a skill_runs row", async () => {
    pushJobLookup();
    pushInvokerLookup(false);

    await handler(BASE_EVENT as never);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

describe("job-trigger skill_run user budget path", () => {
  it("budget-pauses the scheduled job and does not insert or invoke when the owner is over budget", async () => {
    mockSelect
      .mockReturnValueOnce([
        {
          enabled: true,
          budget_paused: false,
          name: "Sales prep daily",
          config: JOB_CONFIG(),
        },
      ])
      .mockReturnValueOnce([{ id: "U1" }])
      .mockReturnValueOnce([{ id: "policy-1", limit_usd: "10.00" }])
      .mockReturnValueOnce([{ total: 12.5 }]);

    await handler(BASE_EVENT as never);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        budget_paused: true,
        budget_paused_reason: "User budget exceeded: $12.50 >= $10.00",
      }),
    );
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

describe("job-trigger skill_run invalid-binding path", () => {
  it("writes invalid_binding audit row and does not invoke", async () => {
    pushJobLookup(
      JOB_CONFIG({
        inputBindings: {
          customer: { from_tenant_config: "missing_key" },
        },
      }),
    );
    pushInvokerLookup(true);
    pushTenantSettings({}); // empty settings → missing_key not found
    mockInsert.mockReturnValueOnce([]);

    await handler(BASE_EVENT as never);

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

describe("job-trigger skill_run dedup path", () => {
  it("does not invoke when INSERT returns zero rows (concurrent fire)", async () => {
    pushJobLookup();
    pushInvokerLookup(true);
    pushTenantSettings({});
    pushAgentSkillEnablement(true);
    mockInsert.mockReturnValueOnce([]); // onConflictDoNothing → no rows

    await handler(BASE_EVENT as never);

    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

describe("job-trigger skill_run invoke-failure path", () => {
  it("transitions row to failed when agentcore-invoke throws", async () => {
    pushJobLookup();
    pushInvokerLookup(true);
    pushTenantSettings({});
    pushAgentSkillEnablement(true);
    mockInsert.mockReturnValueOnce([{ id: "run-1", skill_version: 1 }]);
    mockLambdaSend.mockResolvedValueOnce({
      FunctionError: "Unhandled",
      Payload: new TextEncoder().encode("boom"),
    });

    await handler(BASE_EVENT as never);

    expect(mockUpdate).toHaveBeenCalledTimes(1); // the skill_runs → failed transition
  });
});

describe("job-trigger skill_run no-agent path", () => {
  it("skips the agent_skills check when no agentId is configured", async () => {
    pushJobLookup(JOB_CONFIG({ agentId: undefined }));
    pushInvokerLookup(true);
    pushTenantSettings({});
    // No agent enablement lookup — next lookup is not called
    mockInsert.mockReturnValueOnce([{ id: "run-1", skill_version: 1 }]);

    await handler(BASE_EVENT as never);

    // Five selects: scheduledJobs + budget user/policy + invoker +
    // tenantSettings. No agent_skills.
    expect(mockSelect).toHaveBeenCalledTimes(5);
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
  });
});

describe("job-trigger skill_run misconfiguration", () => {
  it("early-returns when skillId is missing", async () => {
    pushJobLookup({ invokerUserId: "U1", agentId: "A1" });

    await handler(BASE_EVENT as never);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it("early-returns when invokerUserId is missing", async () => {
    pushJobLookup({ skillId: "sales-prep" });

    await handler(BASE_EVENT as never);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

describe("job-trigger eval_scheduled", () => {
  it("creates an eval run for the default AgentCore eval agent", async () => {
    mockSelect.mockReturnValueOnce([
      {
        enabled: true,
        name: "Daily eval",
        config: {
          categories: ["red-team-safety-scope"],
        },
      },
    ]);
    mockInsert.mockReturnValueOnce([{ id: "eval-run-1" }]);

    await handler({
      triggerId: "job-eval-1",
      triggerType: "eval_scheduled",
      tenantId: "T1",
    });

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "T1",
        agent_id: null,
        scheduled_job_id: "job-eval-1",
        status: "pending",
        model: "moonshotai.kimi-k2.5",
        categories: ["red-team-safety-scope"],
      }),
    );
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
  });
});

describe("job-trigger agent_scheduled (Computer kill)", () => {
  it("logs and does nothing for agent schedules after Computer removal", async () => {
    mockSelect.mockReturnValueOnce([
      {
        enabled: true,
        name: "Daily Marco",
        config: {},
        created_by_type: "user",
        created_by_id: "U1",
      },
    ]);

    await handler({
      triggerId: "job-agent-1",
      triggerType: "agent_scheduled",
      tenantId: "T1",
      agentId: "A1",
      prompt: "Check the calendar and prepare a summary",
      scheduleName: "thinkwork-dev-marco-daily",
    });

    expect(mockEnsureThreadForWork).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});

describe("job-trigger thread_idle_memory_learning", () => {
  const idleConfig = {
    internal: true,
    threadId: "thread-1",
    computerId: "computer-1",
    requesterUserId: "user-1",
    activitySequence: 7,
    scheduledFor: "2026-05-18T17:15:00.000Z",
    lastActivityAt: "2026-05-18T17:00:00.000Z",
  };

  it("invokes the worker when the idle snapshot is still current", async () => {
    mockSelect
      .mockReturnValueOnce([
        {
          enabled: true,
          name: "Idle learner",
          config: idleConfig,
        },
      ])
      .mockReturnValueOnce([
        {
          id: "state-1",
          tenantId: "T1",
          threadId: "thread-1",
          computerId: "computer-1",
          requesterUserId: "user-1",
          activitySequence: 7,
          lastActivityAt: new Date("2026-05-18T17:00:00.000Z"),
          scheduledFor: new Date("2026-05-18T17:15:00.000Z"),
        },
      ]);
    mockInsert.mockReturnValueOnce([{ id: "run-1" }]);
    mockLambdaSend.mockResolvedValueOnce({
      StatusCode: 200,
      Payload: new TextEncoder().encode(
        JSON.stringify({ ok: true, status: "no_change" }),
      ),
    });

    await handler({
      triggerId: "job-idle-1",
      triggerType: "thread_idle_memory_learning",
      tenantId: "T1",
    });

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "T1",
        thread_id: "thread-1",
        computer_id: "computer-1",
        requester_user_id: "user-1",
        scheduled_job_id: "job-idle-1",
        activity_sequence: 7,
        status: "running",
      }),
    );
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    const command = mockLambdaSend.mock.calls[0][0] as {
      input: { Payload: Uint8Array };
    };
    const payload = JSON.parse(new TextDecoder().decode(command.input.Payload));
    expect(payload).toMatchObject({
      runId: "run-1",
      tenantId: "T1",
      threadId: "thread-1",
      computerId: "computer-1",
      requesterUserId: "user-1",
      scheduledJobId: "job-idle-1",
      activitySequence: 7,
    });
  });

  it("records a stale no-op when newer thread activity has superseded the fired timer", async () => {
    mockSelect
      .mockReturnValueOnce([
        {
          enabled: true,
          name: "Idle learner",
          config: idleConfig,
        },
      ])
      .mockReturnValueOnce([
        {
          id: "state-1",
          tenantId: "T1",
          threadId: "thread-1",
          computerId: "computer-1",
          requesterUserId: "user-1",
          activitySequence: 8,
          lastActivityAt: new Date("2026-05-18T17:05:00.000Z"),
          scheduledFor: new Date("2026-05-18T17:20:00.000Z"),
        },
      ]);

    await handler({
      triggerId: "job-idle-1",
      triggerType: "thread_idle_memory_learning",
      tenantId: "T1",
    });

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: "T1",
        thread_id: "thread-1",
        scheduled_job_id: "job-idle-1",
        activity_sequence: 7,
        status: "stale_noop",
        metadata: expect.objectContaining({
          currentActivitySequence: 8,
          expectedActivitySequence: 7,
        }),
      }),
    );
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });
});
