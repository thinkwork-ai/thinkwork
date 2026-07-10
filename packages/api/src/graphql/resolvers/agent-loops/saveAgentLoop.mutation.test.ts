import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: vi.fn(),
  insertValues: vi.fn(),
  updateValues: vi.fn(),
  requireAgentLoopWriteAccess: vi.fn(),
  resolveCallerUserId: vi.fn(),
  syncAgentLoopScheduleBinding: vi.fn(),
  syncAgentLoopWebhookBinding: vi.fn(),
  disableAgentLoopScheduleBinding: vi.fn(),
  syncReportAutomationConvergence: vi.fn(),
}));

let selectCall = 0;
let insertCall = 0;

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  desc: vi.fn((value: unknown) => ({ op: "desc", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        // Awaitable directly (the Space-catalog read has no .limit) and via
        // .limit()/.orderBy().limit() — each consumption takes one
        // selectRows slot, preserving the call-index choreography.
        where: () => ({
          then: (
            resolve: (rows: unknown) => void,
            reject: (err: unknown) => void,
          ) => {
            selectCall += 1;
            try {
              resolve(mocks.selectRows(selectCall));
            } catch (err) {
              reject(err);
            }
          },
          limit: async () => {
            selectCall += 1;
            return mocks.selectRows(selectCall);
          },
          orderBy: () => ({
            limit: async () => {
              selectCall += 1;
              return mocks.selectRows(selectCall);
            },
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => {
        insertCall += 1;
        mocks.insertValues(insertCall, values);
        return {
          returning: async () =>
            insertCall === 1
              ? [
                  {
                    id: "loop-1",
                    tenant_id: "tenant-1",
                    name: "Morning escalation review",
                    slug: "morning-escalation-review",
                    description: null,
                    lifecycle_status: "active",
                    enabled: true,
                    primary_trigger_family: "manual",
                    current_version_id: null,
                    current_version_number: null,
                    created_at: new Date("2026-06-23T00:00:00Z"),
                    updated_at: new Date("2026-06-23T00:00:00Z"),
                  },
                ]
              : [
                  {
                    id: "version-1",
                    version_number: 1,
                  },
                ],
        };
      },
    }),
    update: () => ({
      set: (values: unknown) => {
        mocks.updateValues(values);
        return {
          where: async () => [],
        };
      },
    }),
  },
  agents: {
    id: "agents.id",
    name: "agents.name",
    tenant_id: "agents.tenant_id",
    type: "agents.type",
    is_platform_default: "agents.is_platform_default",
  },
  agentLoops: {
    id: "agent_loops.id",
    tenant_id: "agent_loops.tenant_id",
    current_version_id: "agent_loops.current_version_id",
    current_version_number: "agent_loops.current_version_number",
    slug: "agent_loops.slug",
    space_id: "agent_loops.space_id",
  },
  spaces: {
    id: "spaces.id",
    tenant_id: "spaces.tenant_id",
    status: "spaces.status",
  },
  agentLoopVersions: {
    id: "agent_loop_versions.id",
    agent_loop_id: "agent_loop_versions.agent_loop_id",
    version_number: "agent_loop_versions.version_number",
  },
  generateSlug: () => "generated-slug",
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mocks.resolveCallerUserId,
}));

vi.mock("../../../lib/agent-loops/schedule-binding.js", () => ({
  syncAgentLoopScheduleBinding: mocks.syncAgentLoopScheduleBinding,
  disableAgentLoopScheduleBinding: mocks.disableAgentLoopScheduleBinding,
}));

vi.mock("../../../lib/agent-loops/report-convergence.js", () => ({
  syncReportAutomationConvergence: mocks.syncReportAutomationConvergence,
}));

vi.mock("../../../lib/agent-loops/webhook-binding.js", () => ({
  syncAgentLoopWebhookBinding: mocks.syncAgentLoopWebhookBinding,
}));

vi.mock("./types.js", () => ({
  agentLoopRowToGraphql: (row: unknown) => row,
  parseAwsJsonObject: (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {},
}));

vi.mock("./write-access.js", () => ({
  requireAgentLoopWriteAccess: mocks.requireAgentLoopWriteAccess,
}));

// eslint-disable-next-line import/first
import {
  saveAgentLoop,
  resolveAgentLoopSpaceId,
} from "./saveAgentLoop.mutation.js";

const ctx = () =>
  ({
    auth: {
      authType: "cognito" as const,
      principalId: "sub-1",
      tenantId: "tenant-1",
      email: "eric@example.com",
      agentId: null,
    },
  }) as any;

beforeEach(() => {
  selectCall = 0;
  insertCall = 0;
  mocks.selectRows.mockReset();
  mocks.insertValues.mockReset();
  mocks.updateValues.mockReset();
  mocks.requireAgentLoopWriteAccess.mockReset().mockResolvedValue(undefined);
  mocks.resolveCallerUserId.mockReset().mockResolvedValue("user-1");
  mocks.syncAgentLoopScheduleBinding.mockReset().mockResolvedValue(undefined);
  mocks.syncAgentLoopWebhookBinding.mockReset().mockResolvedValue(undefined);
  mocks.disableAgentLoopScheduleBinding.mockReset().mockResolvedValue({
    scheduledJobId: null,
    changed: false,
  });
  // Default: not report-shaped → legacy schedule binding path.
  mocks.syncReportAutomationConvergence.mockReset().mockResolvedValue(null);
});

describe("saveAgentLoop", () => {
  it("saves an easy prompt-only draft by inferring goal, worker, and judge defaults", async () => {
    mocks.selectRows.mockImplementation(async (call: number) => {
      if (call === 1) {
        return [{ id: "agent-1", label: "ThinkWork Agent" }];
      }
      if (call === 2) {
        return [{ id: "space-1" }];
      }
      if (call === 3) {
        return [
          {
            id: "loop-1",
            tenant_id: "tenant-1",
            name: "Morning escalation review",
            slug: "morning-escalation-review",
            description: null,
            lifecycle_status: "active",
            enabled: true,
            primary_trigger_family: "manual",
            current_version_id: "version-1",
            current_version_number: 1,
            created_at: new Date("2026-06-23T00:00:00Z"),
            updated_at: new Date("2026-06-23T00:00:00Z"),
          },
        ];
      }
      return [];
    });

    await saveAgentLoop(
      null,
      {
        input: {
          tenantId: "tenant-1",
          name: "Morning escalation review",
          spaceId: "space-1",
          lifecycleStatus: "active",
          enabled: true,
          triggerSpec: {
            family: "manual",
            enabled: true,
            source: "manual",
            config: {},
          },
          goalSpec: {
            objective: "Review support escalations every morning.",
            completionCriteria: [],
          },
          workerSpec: { type: "agent", id: "", toolHints: [], config: {} },
          sourceMetadata: {
            createdFrom: "settings.automations.easy",
            creationMode: "easy",
            prompt: "Review support escalations every morning.",
          },
        },
      },
      ctx(),
    );

    expect(mocks.requireAgentLoopWriteAccess).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      expect.objectContaining({
        operationName: "save_agent_loop",
        actorId: "user-1",
      }),
    );
    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({
        space_id: "space-1",
        // R1: run-as identity defaults to the caller when absent.
        run_as_user_id: "user-1",
      }),
    );
    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      2,
      2,
      expect.objectContaining({
        // R3: target_spec derived from the legacy inputs (never NULL). THINK-159:
        // it is the SOLE persisted dispatch source.
        target_spec: {
          kind: "agent_thread",
          agentThread: {
            instructions: "Review support escalations every morning.",
            completionCriteria: [
              "The agent produces a useful response or next step for the automation prompt.",
            ],
            workerId: "agent-1",
            workerType: "agent",
            threadMode: "new_per_run",
          },
        },
        source_metadata: expect.objectContaining({
          createdFrom: "settings.automations.easy",
          goalInference: "runtime_inferred",
          workerInference: "tenant_default_agent",
        }),
      }),
    );
    // THINK-159: goal_spec/worker_spec/loop_policy are no longer written.
    const versionInsert = mocks.insertValues.mock.calls.find(
      (call: unknown[]) => call[0] === 2,
    )?.[1] as Record<string, unknown>;
    expect(versionInsert).not.toHaveProperty("goal_spec");
    expect(versionInsert).not.toHaveProperty("worker_spec");
    expect(versionInsert).not.toHaveProperty("loop_policy");
    expect(mocks.syncAgentLoopScheduleBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        workerAgentId: "agent-1",
        spaceId: "space-1",
        goalObjective: "Review support escalations every morning.",
      }),
    );
  });

  it("writes a caller-supplied targetSpec verbatim (wins over legacy derivation) and honors an explicit runAsUserId", async () => {
    mocks.selectRows.mockImplementation(async (call: number) => {
      if (call === 1) return [{ id: "space-1" }]; // resolveAgentLoopSpaceId
      if (call === 2) {
        return [
          {
            id: "loop-1",
            tenant_id: "tenant-1",
            name: "Scheduled brief",
            slug: "scheduled-brief",
            lifecycle_status: "active",
            enabled: true,
            primary_trigger_family: "schedule",
            current_version_id: "version-1",
            current_version_number: 1,
            created_at: new Date("2026-06-23T00:00:00Z"),
            updated_at: new Date("2026-06-23T00:00:00Z"),
          },
        ];
      }
      return [];
    });

    await saveAgentLoop(
      null,
      {
        input: {
          tenantId: "tenant-1",
          name: "Scheduled brief",
          spaceId: "space-1",
          lifecycleStatus: "active",
          enabled: true,
          runAsUserId: "user-42",
          triggerSpec: {
            family: "schedule",
            enabled: true,
            config: { expression: "rate(1 day)" },
          },
          goalSpec: {
            objective: "Legacy objective that must be overridden",
            completionCriteria: ["legacy"],
          },
          workerSpec: {
            type: "agent",
            id: "agent-9",
            toolHints: [],
            config: {},
          },
          targetSpec: {
            kind: "agent_thread",
            agentThread: {
              instructions: "Authoritative instructions",
              completionCriteria: ["A brief exists."],
              workerId: "agent-9",
              workerType: "agent",
              threadMode: "new_per_run",
            },
          },
          // sourceMetadata omitted → not prompt-first → no default-worker load.
        },
      },
      ctx(),
    );

    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      1,
      1,
      expect.objectContaining({ run_as_user_id: "user-42" }),
    );
    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      2,
      2,
      expect.objectContaining({
        target_spec: {
          kind: "agent_thread",
          agentThread: {
            instructions: "Authoritative instructions",
            completionCriteria: ["A brief exists."],
            workerId: "agent-9",
            workerType: "agent",
            threadMode: "new_per_run",
          },
        },
      }),
    );
  });

  // R4 (THINK-137 U4): an agent_thread target needs a Space.
  it("rejects an agent_thread targetSpec with no Space at save time", async () => {
    await expect(
      saveAgentLoop(
        null,
        {
          input: {
            tenantId: "tenant-1",
            name: "Spaceless agent thread",
            // spaceId omitted → headless is not allowed for agent_thread.
            lifecycleStatus: "active",
            enabled: true,
            triggerSpec: { family: "manual", enabled: true, config: {} },
            goalSpec: { objective: "Do the thing", completionCriteria: ["ok"] },
            workerSpec: {
              type: "agent",
              id: "agent-9",
              toolHints: [],
              config: {},
            },
            targetSpec: {
              kind: "agent_thread",
              agentThread: {
                instructions: "Do the thing",
                workerId: "agent-9",
                workerType: "agent",
                threadMode: "new_per_run",
              },
            },
          },
        },
        ctx(),
      ),
    ).rejects.toThrow(/Agent-thread automations need a Space/);
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  // THINK-227 U13: a report-shaped automation converges at save time and its
  // schedule rides the workflow — the legacy binding goes quiet.
  it("converges a document-bound automation and disables the legacy schedule binding", async () => {
    mocks.selectRows.mockImplementation(async (call: number) => {
      // Calls 1–2: resolveAgentLoopSpaceId for the automation's Space and
      // the binding's Space (both 'space-1').
      if (call <= 2) return [{ id: "space-1" }];
      return [
        {
          id: "loop-1",
          tenant_id: "tenant-1",
          name: "Weekly Pipeline Report",
          slug: "weekly-pipeline-report",
          lifecycle_status: "active",
          enabled: true,
          primary_trigger_family: "schedule",
          current_version_id: "version-1",
          current_version_number: 1,
          created_at: new Date("2026-06-23T00:00:00Z"),
          updated_at: new Date("2026-06-23T00:00:00Z"),
        },
      ];
    });
    mocks.syncReportAutomationConvergence.mockResolvedValue({
      workflowId: "wf-1",
      workflowVersionId: "wfv-1",
      published: true,
    });

    await saveAgentLoop(
      null,
      {
        input: {
          tenantId: "tenant-1",
          name: "Weekly Pipeline Report",
          spaceId: "space-1",
          lifecycleStatus: "active",
          enabled: true,
          triggerSpec: {
            family: "schedule",
            enabled: true,
            config: {
              scheduleExpression: "cron(0 8 ? * MON *)",
              timezone: "America/Chicago",
            },
          },
          goalSpec: { objective: "n/a", completionCriteria: ["done"] },
          workerSpec: {
            type: "agent",
            id: "agent-9",
            toolHints: [],
            config: {},
          },
          targetSpec: {
            kind: "agent_thread",
            agentThread: {
              instructions: "Refresh the pipeline report",
              workerId: "agent-9",
              workerType: "agent",
              threadMode: "new_per_run",
            },
            documentBinding: {
              mode: "create",
              genre: "report",
              title: "Weekly Pipeline Report",
              spaceId: "space-1",
            },
            delivery: { recipients: ["ops@example.com"] },
          },
        },
      },
      ctx(),
    );

    expect(mocks.syncReportAutomationConvergence).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        loop: expect.objectContaining({ id: "loop-1" }),
        version: expect.objectContaining({
          targetSpec: expect.objectContaining({
            documentBinding: expect.objectContaining({ mode: "create" }),
            delivery: { recipients: ["ops@example.com"] },
          }),
        }),
      }),
    );
    expect(mocks.disableAgentLoopScheduleBinding).toHaveBeenCalledWith(
      "tenant-1",
      "loop-1",
    );
    expect(mocks.syncAgentLoopScheduleBinding).not.toHaveBeenCalled();
  });

  it("saves a routine target with no Space (headless is allowed)", async () => {
    mocks.selectRows.mockImplementation(async () => [
      {
        id: "loop-1",
        tenant_id: "tenant-1",
        name: "Nightly routine",
        slug: "nightly-routine",
        lifecycle_status: "active",
        enabled: true,
        primary_trigger_family: "schedule",
        current_version_id: "version-1",
        current_version_number: 1,
        created_at: new Date("2026-06-23T00:00:00Z"),
        updated_at: new Date("2026-06-23T00:00:00Z"),
      },
    ]);

    await saveAgentLoop(
      null,
      {
        input: {
          tenantId: "tenant-1",
          name: "Nightly routine",
          // no spaceId — headless routine target
          lifecycleStatus: "active",
          enabled: true,
          triggerSpec: {
            family: "schedule",
            enabled: true,
            config: { expression: "rate(1 day)" },
          },
          goalSpec: { objective: "n/a", completionCriteria: ["done"] },
          workerSpec: {
            type: "agent",
            id: "agent-9",
            toolHints: [],
            config: {},
          },
          targetSpec: {
            kind: "routine",
            routine: {
              routineId: "33333333-3333-4333-8333-333333333333",
              label: "Nightly",
            },
          },
        },
      },
      ctx(),
    );

    expect(mocks.insertValues).toHaveBeenNthCalledWith(
      2,
      2,
      expect.objectContaining({
        target_spec: expect.objectContaining({ kind: "routine" }),
      }),
    );
  });
});

// THINK-246: conversational callers pass Space slugs/names where the column
// wants the UUID; the resolver resolves all three and a miss names the
// tenant's actual Spaces (unmasked BAD_USER_INPUT).
describe("resolveAgentLoopSpaceId (THINK-246)", () => {
  const CATALOG = [
    {
      id: "ff3b6c66-6ef1-42fb-97bf-62f7be49d8e2",
      name: "General",
      slug: "general",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Customer Ops",
      slug: "customer-ops",
    },
  ];

  beforeEach(() => {
    mocks.selectRows.mockImplementation(async () => CATALOG);
  });

  it("resolves a UUID verbatim", async () => {
    await expect(
      resolveAgentLoopSpaceId("tenant-1", CATALOG[0].id),
    ).resolves.toBe(CATALOG[0].id);
  });

  it("resolves a slug to its UUID", async () => {
    await expect(resolveAgentLoopSpaceId("tenant-1", "general")).resolves.toBe(
      CATALOG[0].id,
    );
  });

  it("resolves a name case-insensitively", async () => {
    await expect(
      resolveAgentLoopSpaceId("tenant-1", "customer OPS"),
    ).resolves.toBe(CATALOG[1].id);
  });

  it("a miss lists the tenant's Spaces in an unmasked BAD_USER_INPUT error", async () => {
    await expect(
      resolveAgentLoopSpaceId("tenant-1", "marketing"),
    ).rejects.toMatchObject({
      message: expect.stringMatching(
        /does not match any active Space.*General \(slug: general/s,
      ),
      extensions: { code: "BAD_USER_INPUT" },
    });
  });

  it("null passes through (headless targets save without a Space)", async () => {
    await expect(resolveAgentLoopSpaceId("tenant-1", null)).resolves.toBeNull();
  });
});
