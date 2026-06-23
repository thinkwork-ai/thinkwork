import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  dbMock,
  insertValues,
  deleteWhereCalls,
  spacesTable,
  spaceMembersTable,
  tenantsTable,
  threadsTable,
  threadParticipantsTable,
} = vi.hoisted(() => {
  const col = (label: string) => ({ __col: label });
  const spaces = {
    id: col("spaces.id"),
    tenant_id: col("spaces.tenant_id"),
    slug: col("spaces.slug"),
    status: col("spaces.status"),
    access_mode: col("spaces.access_mode"),
    template_key: col("spaces.template_key"),
  };
  const spaceMembers = {
    tenant_id: col("space_members.tenant_id"),
    space_id: col("space_members.space_id"),
  };
  const tenants = {
    id: col("tenants.id"),
    issue_counter: col("tenants.issue_counter"),
  };
  const threads = {
    id: col("threads.id"),
    tenant_id: col("threads.tenant_id"),
    workspace_folder_name: col("threads.workspace_folder_name"),
  };
  const threadParticipants = {
    id: col("thread_participants.id"),
  };
  const inserted: unknown[] = [];
  const deletes: unknown[] = [];

  const db = {
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        inserted.push({ table, values });
        if (table === spaces) {
          return {
            onConflictDoUpdate: vi.fn(() => ({
              returning: vi.fn(async () => [
                { id: "space-1", tenant_id: "tenant-1", status: "active" },
              ]),
            })),
          };
        }
        if (table === threads) {
          return {
            returning: vi.fn(async () => [{ id: "thread-1" }]),
          };
        }
        return {
          onConflictDoNothing: vi.fn(async () => []),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async (condition: unknown) => {
        deletes.push(condition);
        return [];
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => [{ next_number: 42 }]),
        })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
  };

  return {
    dbMock: db,
    insertValues: inserted,
    deleteWhereCalls: deletes,
    spacesTable: spaces,
    spaceMembersTable: spaceMembers,
    tenantsTable: tenants,
    threadsTable: threads,
    threadParticipantsTable: threadParticipants,
  };
});

vi.mock("../../graphql/utils.js", () => ({
  db: dbMock,
  spaces: spacesTable,
  spaceMembers: spaceMembersTable,
  tenants: tenantsTable,
  threads: threadsTable,
  threadParticipants: threadParticipantsTable,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ __and: conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ __eq: { field, value } })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sql: { text: strings.join("?"), values },
  })),
}));

import { createAutomationBuilderThread } from "./automation-builder-threads.js";

beforeEach(() => {
  insertValues.length = 0;
  deleteWhereCalls.length = 0;
  vi.clearAllMocks();
});

describe("createAutomationBuilderThread", () => {
  it("creates hidden builder threads in a private system Space with explicit participants", async () => {
    const created = await createAutomationBuilderThread({
      tenantId: "tenant-1",
      userId: "user-1",
      title: "Build escalation automation",
    });

    expect(created).toMatchObject({
      threadId: "thread-1",
      spaceId: "space-1",
      identifier: "AUTO-BUILD-42",
      number: 42,
    });

    const spaceInsert = insertValues.find(
      (entry: any) => entry.table === spacesTable,
    ) as { values: Record<string, unknown> };
    expect(spaceInsert.values).toMatchObject({
      tenant_id: "tenant-1",
      slug: "system-automation-builder",
      access_mode: "private",
      template_key: "system:automation_builder",
      config: expect.objectContaining({
        visibility: "system_hidden",
        purpose: "automation_builder",
      }),
    });
    expect(deleteWhereCalls).toHaveLength(1);

    const threadInsert = insertValues.find(
      (entry: any) => entry.table === threadsTable,
    ) as { values: Record<string, unknown> };
    expect(threadInsert.values).toMatchObject({
      tenant_id: "tenant-1",
      space_id: "space-1",
      user_id: "user-1",
      channel: "chat",
      metadata: expect.objectContaining({
        systemHidden: true,
        visibility: "system_hidden",
        purpose: "automation_builder",
        creationMode: "chat",
      }),
    });

    const participantInsert = insertValues.find(
      (entry: any) => entry.table === threadParticipantsTable,
    ) as { values: Record<string, unknown> };
    expect(participantInsert.values).toMatchObject({
      tenant_id: "tenant-1",
      thread_id: "thread-1",
      space_id: "space-1",
      participant_type: "user",
      user_id: "user-1",
      source: "automation_builder",
    });
  });
});
