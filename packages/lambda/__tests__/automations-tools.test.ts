import { describe, expect, it } from "vitest";
import { schema } from "@thinkwork/database-pg";
import { getAutomation, listAutomations } from "../automations-tools.js";

const { agentLoops, agentLoopVersions, agentLoopRuns } = schema;

const TENANT = "00000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000ff";
const LOOP_A = "11111111-1111-4111-8111-111111111111";
const LOOP_B = "22222222-2222-4222-8222-222222222222";
const VERSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROUTINE_ID = "33333333-3333-4333-8333-333333333333";

// ---------------------------------------------------------------------------
// Fake db — honors tenant scoping (simulates the WHERE tenant_id = ?) so the
// tests prove reads only surface the caller tenant's rows. Ignores the opaque
// drizzle projection/conditions and returns seeded snake_case rows directly,
// matching the routine-repo-tools.test.ts injected-db precedent.
// ---------------------------------------------------------------------------
function fakeDb(
  store: {
    loops?: Record<string, unknown>[];
    versions?: Record<string, unknown>[];
    runs?: Record<string, unknown>[];
  },
  scopeTenant: string,
) {
  const scoped = (rows: Record<string, unknown>[]) =>
    rows.filter((r) => r.tenant_id === scopeTenant);
  const rowsFor = (table: unknown): Record<string, unknown>[] => {
    if (table === agentLoops) return scoped(store.loops ?? []);
    if (table === agentLoopVersions) return scoped(store.versions ?? []);
    if (table === agentLoopRuns) return scoped(store.runs ?? []);
    return [];
  };
  return {
    select: (_proj?: unknown) => ({
      from: (table: unknown) => {
        const rows = rowsFor(table);
        const chain = {
          where: () => chain,
          orderBy: () => chain,
          limit: (n: number) => Promise.resolve(rows.slice(0, n)),
          then: (resolve: (rows: unknown[]) => void) => resolve(rows),
        };
        return chain;
      },
    }),
  } as unknown as Parameters<typeof listAutomations>[0]["db"];
}

function loopRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LOOP_A,
    tenant_id: TENANT,
    name: "Daily research",
    description: "Prepare the daily brief",
    enabled: true,
    primary_trigger_family: "schedule",
    run_as_user_id: "user-run-as",
    space_id: "space-1",
    current_version_id: VERSION_A,
    last_run_id: "run-last",
    last_run_status: "completed",
    last_run_at: new Date("2026-06-22T12:00:00Z"),
    ...overrides,
  };
}

function targetVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_A,
    tenant_id: TENANT,
    goal_spec: { objective: "STALE", completionCriteria: [] },
    worker_spec: { type: "agent", id: "legacy-agent", toolHints: [], config: {} },
    routine_actions_spec: null,
    trigger_spec: { family: "schedule", source: "cron:daily", config: {} },
    target_spec: {
      kind: "agent_thread",
      agentThread: {
        instructions: "Do the thing",
        workerId: "target-agent",
        workerType: "agent",
        threadMode: "new_per_run",
      },
    },
    ...overrides,
  };
}

describe("listAutomations", () => {
  it("returns only the caller tenant's loops in the new-model shape", async () => {
    const db = fakeDb(
      {
        loops: [
          loopRow(),
          loopRow({ id: LOOP_B, tenant_id: OTHER_TENANT }),
        ],
        versions: [targetVersionRow()],
      },
      TENANT,
    );

    const result = await listAutomations({ tenantId: TENANT, db });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: LOOP_A,
      name: "Daily research",
      enabled: true,
      trigger: { family: "schedule", source: "cron:daily" },
      target: { kind: "agent_thread", label: "target-agent" },
      runAsUserId: "user-run-as",
      spaceId: "space-1",
      lastRun: {
        id: "run-last",
        status: "completed",
        at: "2026-06-22T12:00:00.000Z",
      },
    });
  });

  it("resolves a legacy version (no target_spec) via the legacy fallback", async () => {
    const db = fakeDb(
      {
        loops: [loopRow({ current_version_id: VERSION_B })],
        versions: [
          {
            id: VERSION_B,
            tenant_id: TENANT,
            goal_spec: {
              objective: "Prepare the brief",
              completionCriteria: ["done"],
            },
            worker_spec: {
              type: "agent",
              id: "legacy-worker",
              toolHints: [],
              config: {},
            },
            routine_actions_spec: null,
            trigger_spec: { family: "manual", config: {} },
            target_spec: null,
          },
        ],
      },
      TENANT,
    );

    const [item] = await listAutomations({ tenantId: TENANT, db });
    expect(item.target).toEqual({
      kind: "agent_thread",
      label: "legacy-worker",
    });
    expect(item.trigger).toEqual({ family: "manual", source: null });
  });

  it("presents a routine-kind target's label from a legacy routine-only row", async () => {
    const db = fakeDb(
      {
        loops: [loopRow({ current_version_id: VERSION_B, last_run_id: null })],
        versions: [
          {
            id: VERSION_B,
            tenant_id: TENANT,
            goal_spec: { objective: "", completionCriteria: [] },
            worker_spec: { type: "agent", id: "", toolHints: [], config: {} },
            routine_actions_spec: {
              actions: [{ routineId: ROUTINE_ID, label: "LastMile check" }],
              agentTurn: false,
            },
            trigger_spec: { family: "schedule", source: "cron", config: {} },
            target_spec: null,
          },
        ],
      },
      TENANT,
    );

    const [item] = await listAutomations({ tenantId: TENANT, db });
    expect(item.target).toEqual({ kind: "routine", label: "LastMile check" });
    expect(item.lastRun).toBeNull();
  });
});

describe("getAutomation", () => {
  it("returns detail shape with description, target detail, and recentRuns (tenant-scoped)", async () => {
    const db = fakeDb(
      {
        loops: [loopRow()],
        versions: [targetVersionRow()],
        runs: [
          {
            id: "run-1",
            tenant_id: TENANT,
            agent_loop_id: LOOP_A,
            status: "completed",
            trigger_family: "schedule",
            trigger_source: "cron:daily",
            created_at: new Date("2026-06-22T12:00:00Z"),
            finished_at: new Date("2026-06-22T12:05:00Z"),
            error_code: null,
            error_message: null,
          },
          {
            id: "run-cross-tenant",
            tenant_id: OTHER_TENANT,
            agent_loop_id: LOOP_A,
            status: "failed",
            trigger_family: "schedule",
            trigger_source: "cron:daily",
            created_at: new Date("2026-06-21T12:00:00Z"),
            finished_at: null,
            error_code: "boom",
            error_message: "leak",
          },
        ],
      },
      TENANT,
    );

    const detail = await getAutomation({
      tenantId: TENANT,
      automationId: LOOP_A,
      db,
    });

    expect(detail).toMatchObject({
      id: LOOP_A,
      name: "Daily research",
      description: "Prepare the daily brief",
      enabled: true,
      trigger: { family: "schedule", source: "cron:daily" },
      target: { kind: "agent_thread", label: "target-agent" },
      runAsUserId: "user-run-as",
      spaceId: "space-1",
    });
    // Cross-tenant run must not leak.
    expect(detail.recentRuns).toEqual([
      {
        id: "run-1",
        status: "completed",
        triggerFamily: "schedule",
        triggerSource: "cron:daily",
        createdAt: "2026-06-22T12:00:00.000Z",
        finishedAt: "2026-06-22T12:05:00.000Z",
        errorCode: null,
        errorMessage: null,
      },
    ]);
  });

  it("throws not-found for an automation that belongs to another tenant", async () => {
    const db = fakeDb(
      { loops: [loopRow({ tenant_id: OTHER_TENANT })] },
      TENANT,
    );
    await expect(
      getAutomation({ tenantId: TENANT, automationId: LOOP_A, db }),
    ).rejects.toThrow(/not found in tenant/);
  });
});
