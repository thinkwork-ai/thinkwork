import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectRows: vi.fn(),
  insertValues: vi.fn(),
  updateValues: vi.fn(),
  requireAgentLoopAdmin: vi.fn(),
  resolveCallerUserId: vi.fn(),
  syncAgentLoopScheduleBinding: vi.fn(),
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
});

describe("saveAgentLoop", () => {
  it("saves an easy prompt-only draft by inferring goal, worker, and judge defaults", async () => {
    mocks.selectRows.mockImplementation(async (call: number) => {
      if (call === 1) {
        return [{ id: "agent-1", label: "ThinkWork Agent" }];
      }
      if (call === 2) {
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
          judgeSpec: { mode: "self_check", criteria: [], config: {} },
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
        judge_spec: expect.objectContaining({
          mode: "self_check",
          criteria: expect.arrayContaining([
            "The response addresses the automation prompt.",
          ]),
        }),
        source_metadata: expect.objectContaining({
          createdFrom: "settings.automations.easy",
          goalInference: "runtime_inferred",
          workerInference: "tenant_default_agent",
          judgeInference: "default_self_check",
        }),
      }),
    );
    expect(mocks.syncAgentLoopScheduleBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        workerAgentId: "agent-1",
        goalObjective: "Review support escalations every morning.",
      }),
    );
  });
});
