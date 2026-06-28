import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  buildInsertChainForTest,
  buildSelectChainForTest,
  buildUpdateChainForTest,
  captures,
  mockDb,
  renderSqlValue,
  tables,
} = vi.hoisted(() => {
  const table = (name: string, fields: string[]) =>
    Object.fromEntries([
      ["__table__", name],
      ...fields.map((field) => [field, `${name}.${field}`]),
    ]);

  const tables = {
    workItems: table("work_items", [
      "id",
      "tenant_id",
      "space_id",
      "priority",
      "applicable",
      "blocked",
      "completed_at",
      "archived_at",
      "created_at",
      "updated_at",
      "open_engine_enabled",
      "open_engine_queue_key",
      "open_engine_claimed_by_agent_id",
      "open_engine_claimed_at",
      "open_engine_claim_expires_at",
      "open_engine_human_hold",
      "open_engine_scheduled_at",
      "open_engine_dependency_state",
      "open_engine_routing",
      "owner_user_id",
      "owner_agent_id",
    ]),
    workItemEvents: table("work_item_events", [
      "tenant_id",
      "space_id",
      "work_item_id",
      "actor_user_id",
      "actor_agent_id",
      "event_type",
      "message",
      "metadata",
    ]),
  };

  const captures = {
    selectWhere: [] as Array<{ text: string }>,
    selectOrderBy: [] as unknown[][],
    selectLimit: [] as number[],
    selectQueue: [] as unknown[][],
    updateSet: [] as Record<string, unknown>[],
    updateWhere: [] as Array<{ text: string }>,
    updateReturningQueue: [] as unknown[][],
    insertValues: [] as Record<string, unknown>[],
    insertReturningQueue: [] as unknown[][],
  };

  const buildSelectChain = () => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn((predicate: { text: string }) => {
        captures.selectWhere.push(predicate);
        return chain;
      }),
      orderBy: vi.fn((...order: unknown[]) => {
        captures.selectOrderBy.push(order);
        return chain;
      }),
      limit: vi.fn(async (limit: number) => {
        captures.selectLimit.push(limit);
        return captures.selectQueue.shift() ?? [];
      }),
      then: (resolve: any, reject: any) =>
        Promise.resolve(captures.selectQueue.shift() ?? []).then(
          resolve,
          reject,
        ),
    };
    return chain;
  };

  const buildUpdateChain = () => {
    const chain: any = {
      set: vi.fn((values: Record<string, unknown>) => {
        captures.updateSet.push(values);
        return chain;
      }),
      where: vi.fn((predicate: { text: string }) => {
        captures.updateWhere.push(predicate);
        return chain;
      }),
      returning: vi.fn(async () => captures.updateReturningQueue.shift() ?? []),
    };
    return chain;
  };
  const buildInsertChain = () => {
    const chain: any = {
      values: vi.fn((values: Record<string, unknown>) => {
        captures.insertValues.push(values);
        return chain;
      }),
      returning: vi.fn(async () => captures.insertReturningQueue.shift() ?? []),
    };
    return chain;
  };

  return {
    captures,
    buildInsertChainForTest: buildInsertChain,
    buildSelectChainForTest: buildSelectChain,
    buildUpdateChainForTest: buildUpdateChain,
    mockDb: {} as any,
    renderSqlValue(value: unknown): string {
      if (value && typeof value === "object" && "text" in value) {
        return (value as { text: string }).text;
      }
      if (typeof value === "string") return value;
      if (value && typeof value === "object" && "__table__" in value) {
        return (value as { __table__: string }).__table__;
      }
      if (value && typeof value === "object" && "desc" in value) {
        return `${renderSqlValue((value as { desc: unknown }).desc)} DESC`;
      }
      if (value && typeof value === "object" && "asc" in value) {
        return `${renderSqlValue((value as { asc: unknown }).asc)} ASC`;
      }
      return "?";
    },
    tables,
  };
});

vi.mock("../../graphql/utils.js", () => ({
  and: vi.fn((...conditions: unknown[]) => ({
    text: conditions.map(renderSqlValue).join(" AND "),
  })),
  db: mockDb,
  asc: vi.fn((column: unknown) => ({ asc: column })),
  desc: vi.fn((column: unknown) => ({ desc: column })),
  eq: vi.fn((field: unknown, value: unknown) => ({
    text: `${renderSqlValue(field)} = ${renderSqlValue(value)}`,
  })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: strings.reduce((acc, fragment, index) => {
        const value =
          index < values.length ? renderSqlValue(values[index]) : "";
        return `${acc}${fragment}${value}`;
      }, ""),
    })),
    {
      join: vi.fn((values: unknown[], separator: { text: string }) => ({
        text: values.map(renderSqlValue).join(separator.text),
      })),
    },
  ),
  workItems: tables.workItems,
  workItemEvents: tables.workItemEvents,
}));

import {
  buildOpenEngineQueueSnapshot,
  claimNextOpenEngineWorkItem,
  classifyOpenEngineQueueState,
  listEligibleOpenEngineWorkItems,
  openEngineEligibilityPredicate,
  routeOpenEngineWorkItem,
} from "./open-engine-queue-service.js";

const NOW = new Date("2026-06-27T12:00:00Z");
type CapturedSql = { text: string };

beforeEach(() => {
  mockDb.select = vi.fn(() => buildSelectChainForTest());
  mockDb.update = vi.fn(() => buildUpdateChainForTest());
  mockDb.insert = vi.fn(() => buildInsertChainForTest());
  mockDb.transaction = vi.fn((fn: any) => fn(mockDb));
  captures.selectWhere.length = 0;
  captures.selectOrderBy.length = 0;
  captures.selectLimit.length = 0;
  captures.selectQueue.length = 0;
  captures.updateSet.length = 0;
  captures.updateWhere.length = 0;
  captures.updateReturningQueue.length = 0;
  captures.insertValues.length = 0;
  captures.insertReturningQueue.length = 0;
  vi.clearAllMocks();
});

describe("Open Engine Work Item queue service", () => {
  it("builds the native eligibility predicate for queue-safe pickup", () => {
    const predicate = openEngineEligibilityPredicate(
      { tenantId: "tenant-1", queueKey: "default" },
      NOW,
    ) as unknown as CapturedSql;

    expect(predicate.text).toContain("work_items.open_engine_enabled = true");
    expect(predicate.text).toContain(
      "work_items.open_engine_queue_key IS NOT DISTINCT FROM default",
    );
    expect(predicate.text).toContain("work_items.archived_at IS NULL");
    expect(predicate.text).toContain("work_items.completed_at IS NULL");
    expect(predicate.text).toContain("work_items.applicable = true");
    expect(predicate.text).toContain("work_items.blocked = false");
    expect(predicate.text).toContain(
      "work_items.open_engine_human_hold = false",
    );
    expect(predicate.text).toContain(
      "work_items.open_engine_dependency_state = 'ready'",
    );
    expect(predicate.text).toContain("work_items.open_engine_scheduled_at <=");
    expect(predicate.text).toContain(
      "work_items.open_engine_claim_expires_at <=",
    );
  });

  it("does not treat claimant agentId as an owner-agent routing filter", () => {
    const predicate = openEngineEligibilityPredicate(
      { tenantId: "tenant-1", queueKey: "codex", agentId: "agent-1" },
      NOW,
    ) as unknown as CapturedSql;

    expect(predicate.text).toContain(
      "work_items.open_engine_queue_key IS NOT DISTINCT FROM codex",
    );
    expect(predicate.text).not.toContain("work_items.owner_agent_id = agent-1");
  });

  it("still supports explicit owner-agent filters when requested", () => {
    const predicate = openEngineEligibilityPredicate(
      {
        tenantId: "tenant-1",
        queueKey: "codex",
        ownerAgentId: "agent-owner",
      },
      NOW,
    ) as unknown as CapturedSql;

    expect(predicate.text).toContain(
      "work_items.owner_agent_id = agent-owner",
    );
  });

  it("lists eligible Work Items with deterministic queue ordering", async () => {
    captures.selectQueue.push([{ id: "work-item-1" }]);

    const rows = await listEligibleOpenEngineWorkItems({
      tenantId: "tenant-1",
      queueKey: "default",
      now: NOW,
      limit: 25,
    });

    expect(rows).toEqual([{ id: "work-item-1" }]);
    expect(captures.selectWhere[0]!.text).toContain(
      "work_items.open_engine_human_hold = false",
    );
    expect(captures.selectOrderBy[0]![0]).toMatchObject({
      text: expect.stringContaining("WHEN 'urgent' THEN 0"),
    });
    expect(captures.selectOrderBy[0]![1]).toMatchObject({
      desc: "work_items.created_at",
    });
    expect(captures.selectLimit).toEqual([25]);
  });

  it("claims exactly one eligible Work Item with an expiring lease", async () => {
    captures.updateReturningQueue.push([{ id: "work-item-1" }]);

    const claimed = await claimNextOpenEngineWorkItem({
      tenantId: "tenant-1",
      queueKey: "default",
      agentId: "agent-1",
      now: NOW,
      leaseSeconds: 120,
    });

    expect(claimed).toEqual({ id: "work-item-1" });
    expect(captures.updateSet[0]).toEqual({
      open_engine_claimed_by_agent_id: "agent-1",
      open_engine_claimed_at: NOW,
      open_engine_claim_expires_at: new Date("2026-06-27T12:02:00Z"),
      updated_at: NOW,
    });
    expect(captures.updateWhere[0]!.text).toContain("SELECT work_items.id");
    expect(captures.updateWhere[0]!.text).toContain("LIMIT 1");
    expect(captures.updateWhere[0]!.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(captures.updateWhere[0]!.text).toContain("work_items.created_at");
    expect(captures.updateWhere[0]!.text).toContain(
      "work_items.open_engine_claim_expires_at <=",
    );
  });

  it("returns null when no eligible Work Item can be claimed", async () => {
    captures.updateReturningQueue.push([]);

    await expect(
      claimNextOpenEngineWorkItem({
        tenantId: "tenant-1",
        queueKey: "default",
        agentId: "agent-1",
        now: NOW,
      }),
    ).resolves.toBeNull();
  });

  it("returns one winner when two agents try to claim the same queue", async () => {
    captures.updateReturningQueue.push([{ id: "work-item-1" }], []);

    const [first, second] = await Promise.all([
      claimNextOpenEngineWorkItem({
        tenantId: "tenant-1",
        queueKey: "default",
        agentId: "agent-1",
        now: NOW,
      }),
      claimNextOpenEngineWorkItem({
        tenantId: "tenant-1",
        queueKey: "default",
        agentId: "agent-2",
        now: NOW,
      }),
    ]);

    expect([first, second].filter(Boolean)).toEqual([{ id: "work-item-1" }]);
    expect([first, second].filter((value) => value === null)).toHaveLength(1);
    expect(captures.updateWhere[0]!.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(captures.updateWhere[1]!.text).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("routes a Work Item to another OpenEngine queue and clears active claim fields", async () => {
    captures.selectQueue.push([
      {
        id: "work-item-1",
        tenant_id: "tenant-1",
        space_id: "space-1",
        title: "Route me",
        open_engine_queue_key: "claude",
        owner_user_id: "user-1",
        owner_agent_id: null,
        open_engine_routing: { queueKey: "claude" },
      },
    ]);
    captures.updateReturningQueue.push([
      {
        id: "work-item-1",
        tenant_id: "tenant-1",
        space_id: "space-1",
        open_engine_queue_key: "codex",
        owner_user_id: "user-2",
        owner_agent_id: null,
      },
    ]);
    captures.insertReturningQueue.push([
      {
        id: "event-1",
        tenant_id: "tenant-1",
        work_item_id: "work-item-1",
        event_type: "assigned",
        message: "Hand off to Codex",
      },
    ]);

    const result = await routeOpenEngineWorkItem({
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      targetQueueKey: "Codex",
      targetOwnerUserId: "user-2",
      actorAgentId: "agent-router",
      message: "Hand off to Codex",
      idempotencyKey: "route-key-1",
      now: NOW,
    });

    expect(result.workItem).toMatchObject({
      id: "work-item-1",
      open_engine_queue_key: "codex",
    });
    expect(captures.updateSet[0]).toMatchObject({
      open_engine_enabled: true,
      open_engine_queue_key: "codex",
      owner_user_id: "user-2",
      open_engine_claimed_by_agent_id: null,
      open_engine_claimed_at: null,
      open_engine_claim_expires_at: null,
      updated_at: NOW,
    });
    expect(captures.updateSet[0]!.open_engine_routing).toMatchObject({
      queueKey: "codex",
      lastRoute: expect.objectContaining({
        fromQueueKey: "claude",
        toQueueKey: "codex",
      }),
    });
    expect(captures.insertValues[0]).toMatchObject({
      tenant_id: "tenant-1",
      space_id: "space-1",
      work_item_id: "work-item-1",
      actor_agent_id: "agent-router",
      event_type: "assigned",
      message: "Hand off to Codex",
    });
    expect(captures.insertValues[0]!.metadata).toMatchObject({
      source: "open_engine_route",
      idempotencyKey: "route-key-1",
    });
  });

  it("rejects invalid claim lease windows", async () => {
    await expect(
      claimNextOpenEngineWorkItem({
        tenantId: "tenant-1",
        queueKey: "default",
        agentId: "agent-1",
        now: NOW,
        leaseSeconds: 0,
      }),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
    });
  });

  it("classifies queue states for operator-visible health", () => {
    expect(
      classifyOpenEngineQueueState(
        { open_engine_enabled: true, open_engine_dependency_state: "ready" },
        NOW,
      ),
    ).toBe("eligible");
    expect(
      classifyOpenEngineQueueState(
        {
          open_engine_enabled: true,
          open_engine_dependency_state: "ready",
          open_engine_claimed_by_agent_id: "agent-1",
          open_engine_claim_expires_at: new Date("2026-06-27T11:59:00Z"),
        },
        NOW,
      ),
    ).toBe("stale_claim");
    expect(
      classifyOpenEngineQueueState(
        {
          open_engine_enabled: true,
          open_engine_dependency_state: "ready",
          open_engine_claimed_by_agent_id: "agent-1",
          open_engine_claim_expires_at: new Date("2026-06-27T12:01:00Z"),
        },
        NOW,
      ),
    ).toBe("claimed");
    expect(
      classifyOpenEngineQueueState(
        { open_engine_enabled: true, open_engine_dependency_state: "waiting" },
        NOW,
      ),
    ).toBe("waiting");
  });

  it("builds a queue snapshot with stale claim evidence", () => {
    const snapshot = buildOpenEngineQueueSnapshot(
      { tenantId: "tenant-1", queueKey: "codex" },
      [
        {
          id: "work-item-1",
          title: "Ready",
          open_engine_enabled: true,
          open_engine_dependency_state: "ready",
        },
        {
          id: "work-item-2",
          title: "Expired",
          open_engine_enabled: true,
          open_engine_dependency_state: "ready",
          open_engine_claimed_by_agent_id: "agent-old",
          open_engine_claim_expires_at: new Date("2026-06-27T11:59:00Z"),
        },
      ],
      NOW,
    );

    expect(snapshot.counts.eligible).toBe(1);
    expect(snapshot.counts.stale_claim).toBe(1);
    expect(snapshot.staleClaims).toEqual([
      {
        id: "work-item-2",
        title: "Expired",
        claimedByAgentId: "agent-old",
        claimExpiresAt: "2026-06-27T11:59:00.000Z",
      },
    ]);
  });
});
