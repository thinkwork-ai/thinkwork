import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: vi.fn(),
  insertValues: vi.fn(),
  updateValues: vi.fn(),
  requireAgentLoopAdmin: vi.fn(),
  resolveCallerUserId: vi.fn(),
  syncAgentLoopScheduleBinding: vi.fn(),
  syncAgentLoopWebhookBinding: vi.fn(),
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
        where: () => ({
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
                    accepted_run_count: 0,
                    rejected_run_count: 0,
                    escalated_run_count: 0,
                    total_cost_usd_cents: 0,
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
}));

vi.mock("../../../lib/agent-loops/webhook-binding.js", () => ({
  syncAgentLoopWebhookBinding: mocks.syncAgentLoopWebhookBinding,
}));

vi.mock("./types.js", () => ({
  agentLoopRowToGraphql: (row: unknown) => row,
  parseAwsJsonObject: (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? value : {},
  requireAgentLoopAdmin: mocks.requireAgentLoopAdmin,
}));

// eslint-disable-next-line import/first
import { saveAgentLoop } from "./saveAgentLoop.mutation.js";

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
  mocks.requireAgentLoopAdmin.mockReset().mockResolvedValue(undefined);
  mocks.resolveCallerUserId.mockReset().mockResolvedValue("user-1");
  mocks.syncAgentLoopScheduleBinding.mockReset().mockResolvedValue(undefined);
  mocks.syncAgentLoopWebhookBinding.mockReset().mockResolvedValue(undefined);
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
            accepted_run_count: 0,
            rejected_run_count: 0,
            escalated_run_count: 0,
            total_cost_usd_cents: 0,
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

    expect(mocks.requireAgentLoopAdmin).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "save_agent_loop",
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
        goal_spec: expect.objectContaining({
          objective: "Review support escalations every morning.",
          completionCriteria: [
            "The agent produces a useful response or next step for the automation prompt.",
          ],
        }),
        worker_spec: expect.objectContaining({
          type: "agent",
          id: "agent-1",
          label: "ThinkWork Agent",
        }),
        // R3: target_spec derived from the legacy inputs (never NULL).
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
