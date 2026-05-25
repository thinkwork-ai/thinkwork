import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, resetDb, selectRows, txInserts } = vi.hoisted(() => {
  const rows: unknown[][] = [];
  const inserts: Array<{ table: unknown; values: unknown }> = [];

  function insertBuilder(table: unknown) {
    return {
      values(value: unknown) {
        inserts.push({ table, values: value });
        return {
          onConflictDoNothing: vi.fn(async () => undefined),
          returning: vi.fn(async () => {
            if ((table as { id?: unknown }).id === "threads.id") {
              return [{ id: "thread-email-1" }];
            }
            if ((table as { id?: unknown }).id === "messages.id") {
              return [{ id: "message-email-1" }];
            }
            return [];
          }),
        };
      },
    };
  }

  const tx = {
    insert: vi.fn(insertBuilder),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ nextNumber: 42 }]),
        })),
      })),
    })),
  };

  return {
    db: {
      insert: vi.fn(insertBuilder),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => rows.shift() ?? []),
          })),
        })),
      })),
      transaction: vi.fn(async (fn: (arg: typeof tx) => unknown) => fn(tx)),
    },
    resetDb: () => {
      rows.length = 0;
      inserts.length = 0;
    },
    selectRows: rows,
    txInserts: inserts,
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
  ne: (left: unknown, right: unknown) => ({ type: "ne", left, right }),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join("?"),
    values,
  })),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => db,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agents: {
    id: "agents.id",
    is_platform_default: "agents.is_platform_default",
    name: "agents.name",
    tenant_id: "agents.tenant_id",
  },
  messages: { id: "messages.id" },
  tenants: { id: "tenants.id", issue_counter: "tenants.issue_counter" },
  threadParticipants: {},
  threads: { id: "threads.id" },
}));

vi.mock("../agents/tenant-platform-agent.js", async () => {
  const actual = (await vi.importActual(
    "../agents/tenant-platform-agent.js",
  )) as object;
  return {
    ...actual,
    resolveTenantPlatformAgent: vi.fn(async () => ({
      id: "agent-platform",
      name: "Thinkwork",
    })),
  };
});

import { createColdContactThread } from "./cold-contact-trigger.js";

describe("createColdContactThread", () => {
  beforeEach(() => resetDb());

  it("creates a Space thread, opening message, and participants", async () => {
    const result = await createColdContactThread({
      tenantId: "tenant-acme",
      spaceId: "space-finance",
      senderUserId: "user-eric",
      senderEmail: "eric@acme.com",
      emailSubject: "Finance check-in",
      emailBody: "Can you review the close packet?",
      sesMessageId: "ses-1",
      originalMessageId: "<external-1@example.com>",
    });

    expect(result).toEqual({
      messageId: "message-email-1",
      threadId: "thread-email-1",
    });
    expect(txInserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: expect.objectContaining({ id: "threads.id" }),
          values: expect.objectContaining({
            agent_id: "agent-platform",
            channel: "email",
            identifier: "EMAIL-42",
            space_id: "space-finance",
            user_id: "user-eric",
          }),
        }),
        expect.objectContaining({
          table: expect.objectContaining({ id: "messages.id" }),
          values: expect.objectContaining({
            content: "Can you review the close packet?",
            role: "user",
            sender_id: "user-eric",
          }),
        }),
        expect.objectContaining({
          values: expect.arrayContaining([
            expect.objectContaining({
              agent_id: "agent-platform",
              participant_type: "agent",
              role: "agent",
            }),
          ]),
        }),
      ]),
    );
  });
});
