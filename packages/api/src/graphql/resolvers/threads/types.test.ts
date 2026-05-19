import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, computerRows, spaceRows, participantRows, tables } = vi.hoisted(
  () => {
    const computerRows: Record<string, unknown>[] = [];
    const spaceRows: Record<string, unknown>[] = [];
    const participantRows: Record<string, unknown>[] = [];
    const tables = {
      computers: { id: { __column__: "computers.id" }, __table__: "computers" },
      spaces: { id: { __column__: "spaces.id" }, __table__: "spaces" },
      threadParticipants: {
        tenant_id: { __column__: "thread_participants.tenant_id" },
        thread_id: { __column__: "thread_participants.thread_id" },
        created_at: { __column__: "thread_participants.created_at" },
        __table__: "threadParticipants",
      },
    };
    const rowsFor = (table: any) => {
      if (table === tables.computers) return computerRows;
      if (table === tables.spaces) return spaceRows;
      if (table === tables.threadParticipants) return participantRows;
      return [];
    };
    const chain = (rows: Record<string, unknown>[]) =>
      Object.assign(Promise.resolve(rows), {
        orderBy: vi.fn(async () => rows),
      });
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn((table: any) => ({
          where: vi.fn(() => chain(rowsFor(table))),
        })),
      })),
    };

    return { mockDb, computerRows, spaceRows, participantRows, tables };
  },
);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    db: mockDb,
    eq: vi.fn(() => ({ match: true })),
    and: vi.fn((...conditions: unknown[]) => ({ conditions })),
    asc: vi.fn((column: unknown) => ({ asc: column })),
    computers: tables.computers,
    spaces: tables.spaces,
    threadParticipants: tables.threadParticipants,
    computerToCamel: (row: Record<string, unknown>) => ({
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      slug: row.slug,
      status:
        typeof row.status === "string" ? row.status.toUpperCase() : row.status,
    }),
  };
});

beforeEach(() => {
  computerRows.length = 0;
  spaceRows.length = 0;
  participantRows.length = 0;
});

describe("Thread type attribution resolvers", () => {
  it("resolves a related Computer from thread.computerId", async () => {
    computerRows.push({
      id: "computer-1",
      tenant_id: "tenant-1",
      name: "Base Computer",
      slug: "base-computer",
      status: "active",
    });

    const { threadTypeResolvers } = await import("./types.js");

    await expect(
      threadTypeResolvers.computer({ computerId: "computer-1" }),
    ).resolves.toMatchObject({
      id: "computer-1",
      name: "Base Computer",
      slug: "base-computer",
      status: "ACTIVE",
    });
  });

  it("resolves the request User through the existing user loader", async () => {
    const load = vi.fn(async (id: string) => ({
      id,
      name: "Eric Odom",
      email: "eric@thinkwork.ai",
    }));
    const { threadTypeResolvers } = await import("./types.js");

    await expect(
      threadTypeResolvers.user({ userId: "user-1" }, {}, {
        loaders: { user: { load } },
      } as any),
    ).resolves.toMatchObject({
      id: "user-1",
      name: "Eric Odom",
    });
    expect(load).toHaveBeenCalledWith("user-1");
  });

  it("returns null for missing attribution IDs", async () => {
    const { threadTypeResolvers } = await import("./types.js");

    await expect(threadTypeResolvers.computer({})).resolves.toBeNull();
    expect(
      threadTypeResolvers.user({}, {}, {
        loaders: { user: { load: vi.fn() } },
      } as any),
    ).toBeNull();
  });

  it("resolves a related Space from thread.spaceId", async () => {
    spaceRows.push({
      id: "space-1",
      tenant_id: "tenant-1",
      name: "Customer Onboarding",
      slug: "customer-onboarding",
      status: "active",
      kind: "customer_onboarding",
    });

    const { threadTypeResolvers } = await import("./types.js");

    await expect(
      threadTypeResolvers.space({ spaceId: "space-1" }),
    ).resolves.toMatchObject({
      id: "space-1",
      tenantId: "tenant-1",
      name: "Customer Onboarding",
      status: "ACTIVE",
      kind: "CUSTOMER_ONBOARDING",
    });
  });

  it("resolves Thread participants with GraphQL enum casing", async () => {
    participantRows.push(
      {
        id: "participant-user",
        tenant_id: "tenant-1",
        thread_id: "thread-1",
        participant_type: "user",
        user_id: "user-1",
        role: "requester",
        source: "thread_creator",
        notification_preference: "subscribed",
      },
      {
        id: "participant-agent",
        tenant_id: "tenant-1",
        thread_id: "thread-1",
        participant_type: "agent",
        agent_id: "agent-1",
        role: "coordinator",
        source: "space_auto_subscribe",
        notification_preference: "mentions",
      },
    );

    const { threadTypeResolvers } = await import("./types.js");

    await expect(
      threadTypeResolvers.participants({
        id: "thread-1",
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "participant-user",
        tenantId: "tenant-1",
        threadId: "thread-1",
        participantType: "USER",
        userId: "user-1",
        notificationPreference: "SUBSCRIBED",
      }),
      expect.objectContaining({
        id: "participant-agent",
        participantType: "AGENT",
        agentId: "agent-1",
        notificationPreference: "MENTIONS",
      }),
    ]);
  });

  it("resolves ThreadParticipant user and agent through loaders", async () => {
    const userLoad = vi.fn(async (id: string) => ({ id, name: "Sales Rep" }));
    const agentLoad = vi.fn(async (id: string) => ({
      id,
      name: "@coordinator",
    }));
    const ctx = {
      loaders: {
        user: { load: userLoad },
        agent: { load: agentLoad },
      },
    } as any;
    const { threadParticipantTypeResolvers } = await import("./types.js");

    await expect(
      threadParticipantTypeResolvers.user({ userId: "user-1" }, {}, ctx),
    ).resolves.toMatchObject({ id: "user-1", name: "Sales Rep" });
    await expect(
      threadParticipantTypeResolvers.agent({ agentId: "agent-1" }, {}, ctx),
    ).resolves.toMatchObject({ id: "agent-1", name: "@coordinator" });
    expect(userLoad).toHaveBeenCalledWith("user-1");
    expect(agentLoad).toHaveBeenCalledWith("agent-1");
  });
});
