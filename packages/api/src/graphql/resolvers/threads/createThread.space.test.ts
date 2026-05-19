import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";

const {
  captures,
  mockDb,
  mockRequireTenantMember,
  mockResolveCallerFromAuth,
  mockResolveThreadComputer,
  mockHasSpaceMemberAccess,
  tables,
} = vi.hoisted(() => {
  const tables = {
    agents: { id: { __column__: "agents.id" }, tenant_id: "agents.tenant_id" },
    tenants: {
      id: { __column__: "tenants.id" },
      issue_counter: { __column__: "tenants.issue_counter" },
    },
    threads: { id: { __column__: "threads.id" } },
    messages: { id: { __column__: "messages.id" } },
    spaces: {
      id: { __column__: "spaces.id" },
      tenant_id: { __column__: "spaces.tenant_id" },
      status: { __column__: "spaces.status" },
    },
    spaceAgentAssignments: {
      tenant_id: { __column__: "space_agent_assignments.tenant_id" },
      space_id: { __column__: "space_agent_assignments.space_id" },
      status: { __column__: "space_agent_assignments.status" },
      auto_subscribe: { __column__: "space_agent_assignments.auto_subscribe" },
      agent_id: { __column__: "space_agent_assignments.agent_id" },
      local_role: { __column__: "space_agent_assignments.local_role" },
    },
    threadParticipants: { __table__: "thread_participants" },
  };
  const captures = {
    spaceRows: [] as Record<string, unknown>[],
    autoSubscribedAgents: [] as Record<string, unknown>[],
    insertedThreads: [] as Record<string, unknown>[],
    insertedParticipants: [] as unknown[],
    insertedMessages: [] as Record<string, unknown>[],
    transactions: 0,
  };
  const thenableRows = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), {
      where: vi.fn(() => thenableRows(rows)),
    });
  const makeTx = () => ({
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ next_number: 42 }]),
        })),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: any) => {
        if (table === tables.threads) {
          captures.insertedThreads.push(values);
          return {
            returning: vi.fn(async () => [
              {
                id: "thread-1",
                tenant_id: values.tenant_id,
                space_id: values.space_id ?? null,
                user_id: values.user_id ?? null,
                number: values.number,
                identifier: values.identifier,
                title: values.title,
                status: values.status,
                channel: values.channel,
                computer_id: values.computer_id ?? null,
              },
            ]),
          };
        }
        if (table === tables.threadParticipants) {
          captures.insertedParticipants.push(values);
          return Promise.resolve([]);
        }
        if (table === tables.messages) {
          captures.insertedMessages.push(values);
          return {
            returning: vi.fn(async () => [{ id: "message-1" }]),
          };
        }
        return { returning: vi.fn(async () => []) };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => {
          if (table === tables.spaceAgentAssignments) {
            return Promise.resolve(captures.autoSubscribedAgents);
          }
          return Promise.resolve([]);
        }),
      })),
    })),
  });
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => {
          if (table === tables.spaces) {
            return Promise.resolve(captures.spaceRows);
          }
          return Promise.resolve([]);
        }),
      })),
    })),
    transaction: vi.fn(
      async (callback: (tx: ReturnType<typeof makeTx>) => any) => {
        captures.transactions += 1;
        return callback(makeTx());
      },
    ),
  };

  return {
    captures,
    mockDb: db,
    mockRequireTenantMember: vi.fn(async () => "member"),
    mockResolveCallerFromAuth: vi.fn(async () => ({ userId: "user-1" })),
    mockResolveThreadComputer: vi.fn(async () => null),
    mockHasSpaceMemberAccess: vi.fn(async () => true),
    tables,
    thenableRows,
  };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  sql: Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => ({ sql: true }),
    {},
  ),
  agents: tables.agents,
  tenants: tables.tenants,
  threads: tables.threads,
  messages: tables.messages,
  spaces: tables.spaces,
  spaceAgentAssignments: tables.spaceAgentAssignments,
  threadParticipants: tables.threadParticipants,
  threadToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    tenantId: row.tenant_id,
    spaceId: row.space_id,
    userId: row.user_id,
    identifier: row.identifier,
    title: row.title,
    status:
      typeof row.status === "string" ? row.status.toUpperCase() : row.status,
    channel:
      typeof row.channel === "string" ? row.channel.toUpperCase() : row.channel,
  }),
}));

vi.mock("../../notify.js", () => ({
  notifyThreadUpdate: vi.fn(async () => undefined),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantMember: mockRequireTenantMember,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: mockResolveCallerFromAuth,
}));

vi.mock("../../../lib/computers/thread-cutover.js", () => ({
  enqueueComputerThreadTurn: vi.fn(async () => undefined),
  resolveThreadComputer: mockResolveThreadComputer,
  routeRunbookForComputerMessage: vi.fn(async () => false),
}));

vi.mock("../spaces/shared.js", () => ({
  hasSpaceMemberAccess: mockHasSpaceMemberAccess,
}));

import { createThread } from "./createThread.mutation.js";

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  captures.spaceRows.length = 0;
  captures.autoSubscribedAgents.length = 0;
  captures.insertedThreads.length = 0;
  captures.insertedParticipants.length = 0;
  captures.insertedMessages.length = 0;
  captures.transactions = 0;
  mockRequireTenantMember.mockClear();
  mockResolveCallerFromAuth.mockClear();
  mockResolveThreadComputer.mockClear();
  mockHasSpaceMemberAccess.mockReset();
  mockHasSpaceMemberAccess.mockResolvedValue(true);
});

describe("createThread Space participation", () => {
  it("validates Space membership and inserts requester plus auto-subscribed agent participants", async () => {
    captures.spaceRows.push({
      id: "space-1",
      tenant_id: "tenant-1",
      status: "active",
    });
    captures.autoSubscribedAgents.push({
      agent_id: "agent-coordinator",
      local_role: "coordinator",
    });

    const result = await createThread(
      {},
      {
        input: {
          tenantId: "tenant-1",
          spaceId: "space-1",
          title: "Acme onboarding",
          channel: "WEBHOOK",
        },
      },
      ctx,
    );

    expect(mockRequireTenantMember).toHaveBeenCalledWith(ctx, "tenant-1");
    expect(mockHasSpaceMemberAccess).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "space-1",
    );
    expect(captures.insertedThreads[0]).toMatchObject({
      tenant_id: "tenant-1",
      space_id: "space-1",
      user_id: "user-1",
      identifier: "HOOK-42",
      channel: "webhook",
    });
    expect(captures.insertedParticipants[0]).toEqual([
      expect.objectContaining({
        tenant_id: "tenant-1",
        thread_id: "thread-1",
        space_id: "space-1",
        participant_type: "user",
        user_id: "user-1",
        role: "requester",
        source: "thread_creator",
      }),
      expect.objectContaining({
        tenant_id: "tenant-1",
        thread_id: "thread-1",
        space_id: "space-1",
        participant_type: "agent",
        agent_id: "agent-coordinator",
        role: "coordinator",
        source: "space_auto_subscribe",
      }),
    ]);
    expect(result).toMatchObject({
      id: "thread-1",
      tenantId: "tenant-1",
      spaceId: "space-1",
      identifier: "HOOK-42",
      channel: "WEBHOOK",
    });
  });

  it("keeps non-Space thread creation on the existing path without participants", async () => {
    const result = await createThread(
      {},
      {
        input: {
          tenantId: "tenant-1",
          title: "General request",
          channel: "MANUAL",
        },
      },
      ctx,
    );

    expect(mockHasSpaceMemberAccess).not.toHaveBeenCalled();
    expect(captures.insertedThreads[0]).toMatchObject({
      tenant_id: "tenant-1",
      space_id: undefined,
      identifier: "TICK-42",
      channel: "manual",
    });
    expect(captures.insertedParticipants).toEqual([]);
    expect(result).toMatchObject({
      id: "thread-1",
      identifier: "TICK-42",
      channel: "MANUAL",
    });
  });

  it("rejects inactive or cross-tenant Spaces before opening a transaction", async () => {
    captures.spaceRows.push({
      id: "space-1",
      tenant_id: "tenant-2",
      status: "active",
    });

    await expect(
      createThread(
        {},
        {
          input: {
            tenantId: "tenant-1",
            spaceId: "space-1",
            title: "Acme onboarding",
          },
        },
        ctx,
      ),
    ).rejects.toThrow(GraphQLError);
    expect(captures.transactions).toBe(0);
  });
});
