/**
 * Unit coverage for the threadsPaged resolver's filter assembly.
 *
 * Particularly the `computerId` filter added by plan 2026-05-13-005 U1 —
 * verify it appears in the WHERE conditions array when provided and is
 * absent when omitted, without leaking tenant scoping when set.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";

const {
  capturedConditions,
  mockDb,
  mockEq,
  mockAnd,
  mockSql,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockRequireTenantAdmin,
  mockHasSpaceMemberAccess,
  threadsTable,
  threadParticipantsTable,
} = vi.hoisted(() => {
  const captured: unknown[][] = [];

  const eq = vi.fn((field: unknown, value: unknown) => ({
    __eq: { field, value },
  }));
  const and = vi.fn((...conditions: unknown[]) => {
    captured.push(conditions);
    return { __and: conditions };
  });
  const sql = Object.assign(
    (_strings: TemplateStringsArray, ..._values: unknown[]) => ({
      __sql: true,
    }),
    {},
  );
  const asc = vi.fn();
  const desc = vi.fn();

  const tableCol = (label: string) => ({ __col: label });
  const threads = {
    id: tableCol("threads.id"),
    tenant_id: tableCol("threads.tenant_id"),
    computer_id: tableCol("threads.computer_id"),
    space_id: tableCol("threads.space_id"),
    user_id: tableCol("threads.user_id"),
    status: tableCol("threads.status"),
    title: tableCol("threads.title"),
    created_at: tableCol("threads.created_at"),
    updated_at: tableCol("threads.updated_at"),
    last_turn_completed_at: tableCol("threads.last_turn_completed_at"),
    archived_at: tableCol("threads.archived_at"),
  };
  const threadParticipants = {
    tenant_id: tableCol("thread_participants.tenant_id"),
    participant_type: tableCol("thread_participants.participant_type"),
    user_id: tableCol("thread_participants.user_id"),
    thread_id: tableCol("thread_participants.thread_id"),
    last_read_at: tableCol("thread_participants.last_read_at"),
  };

  // db.select().from(threads).where(...).orderBy(...).limit(...).offset(...)
  // db.select({count}).from(threads).where(...)
  // Both branches resolve to []; the resolver just returns empty rows.
  const chainTerminal = () =>
    Object.assign(Promise.resolve([]), {
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn(() => Promise.resolve([])),
    });
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => chainTerminal()),
          // count query path
          then: (
            res: (v: unknown[]) => unknown,
            rej: (e: unknown) => unknown,
          ) => Promise.resolve([{ count: 0 }]).then(res, rej),
        })),
      })),
    })),
  };

  return {
    capturedConditions: captured,
    mockDb: db,
    mockEq: eq,
    mockAnd: and,
    mockSql: sql,
    mockResolveCallerTenantId: vi.fn(async () => "tenant-a" as string | null),
    mockResolveCallerUserId: vi.fn(async () => "user-a" as string | null),
    mockRequireTenantAdmin: vi.fn<() => Promise<"owner" | "admin">>(
      async () => {
        throw new GraphQLError("Tenant admin role required");
      },
    ),
    mockHasSpaceMemberAccess: vi.fn(async () => true),
    mockAsc: asc,
    mockDesc: desc,
    threadsTable: threads,
    threadParticipantsTable: threadParticipants,
  };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: mockEq,
  and: mockAnd,
  desc: vi.fn(),
  asc: vi.fn(),
  sql: mockSql,
  inArray: vi.fn((field: unknown, values: unknown[]) => ({
    __inArray: { field, values },
  })),
  threads: threadsTable,
  threadParticipants: threadParticipantsTable,
  threadToCamel: (row: unknown) => row,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
  hasServiceSecret: (ctx: any) =>
    ctx?.auth?.authType === "apikey" || ctx?.auth?.authType === "service",
}));

vi.mock("../spaces/shared.js", () => ({
  hasSpaceMemberAccess: mockHasSpaceMemberAccess,
}));

import { threadsPaged_query } from "./threadsPaged.query.js";

const TENANT = "tenant-a";
const COMPUTER = "computer-marco";

beforeEach(() => {
  capturedConditions.length = 0;
  mockResolveCallerTenantId.mockReset();
  mockResolveCallerTenantId.mockResolvedValue(TENANT);
  mockResolveCallerUserId.mockReset();
  mockResolveCallerUserId.mockResolvedValue("user-a");
  mockRequireTenantAdmin.mockReset();
  mockRequireTenantAdmin.mockRejectedValue(
    new GraphQLError("Tenant admin role required"),
  );
  mockHasSpaceMemberAccess.mockReset();
  mockHasSpaceMemberAccess.mockResolvedValue(true);
});

describe("threadsPaged filter assembly", () => {
  it("adds tenant_id condition without computer_id when computerId is omitted", async () => {
    await threadsPaged_query({}, { tenantId: TENANT }, {} as any);
    const allConditions = capturedConditions.flat();
    const hasTenant = allConditions.some(
      (c: any) =>
        c?.__eq?.field === threadsTable.tenant_id && c?.__eq?.value === TENANT,
    );
    const hasComputer = allConditions.some(
      (c: any) => c?.__eq?.field === threadsTable.computer_id,
    );
    expect(hasTenant).toBe(true);
    expect(hasComputer).toBe(false);
  });

  it("adds both tenant_id and computer_id conditions when computerId is set", async () => {
    await threadsPaged_query(
      {},
      { tenantId: TENANT, computerId: COMPUTER },
      {} as any,
    );
    const allConditions = capturedConditions.flat();
    const hasTenant = allConditions.some(
      (c: any) =>
        c?.__eq?.field === threadsTable.tenant_id && c?.__eq?.value === TENANT,
    );
    const hasComputer = allConditions.some(
      (c: any) =>
        c?.__eq?.field === threadsTable.computer_id &&
        c?.__eq?.value === COMPUTER,
    );
    expect(hasTenant).toBe(true);
    expect(hasComputer).toBe(true);
  });

  it("does not add computer_id when computerId is an empty string", async () => {
    await threadsPaged_query(
      {},
      { tenantId: TENANT, computerId: "" },
      {} as any,
    );
    const allConditions = capturedConditions.flat();
    const hasComputer = allConditions.some(
      (c: any) => c?.__eq?.field === threadsTable.computer_id,
    );
    expect(hasComputer).toBe(false);
  });

  it("does not rely on owner user_id for non-admin Cognito global lists", async () => {
    await threadsPaged_query({}, { tenantId: TENANT }, {
      auth: { authType: "cognito" },
    } as any);
    const allConditions = capturedConditions.flat();
    const hasUser = allConditions.some(
      (c: any) =>
        c?.__eq?.field === threadsTable.user_id && c?.__eq?.value === "user-a",
    );
    expect(hasUser).toBe(false);
  });

  it("does not add a user_id condition for tenant admins", async () => {
    mockRequireTenantAdmin.mockImplementation(async () => "admin");
    await threadsPaged_query({}, { tenantId: TENANT }, {
      auth: { authType: "cognito" },
    } as any);
    const allConditions = capturedConditions.flat();
    const hasUser = allConditions.some(
      (c: any) => c?.__eq?.field === threadsTable.user_id,
    );
    expect(hasUser).toBe(false);
  });

  it("adds a space_id condition when spaceId is set", async () => {
    await threadsPaged_query(
      {},
      { tenantId: TENANT, spaceId: "space-onboarding" },
      {} as any,
    );
    const allConditions = capturedConditions.flat();
    const hasSpace = allConditions.some(
      (c: any) =>
        c?.__eq?.field === threadsTable.space_id &&
        c?.__eq?.value === "space-onboarding",
    );
    expect(hasSpace).toBe(true);
  });

  it("lets non-admin Space members list collaborative Space threads without a user_id filter", async () => {
    await threadsPaged_query(
      {},
      { tenantId: TENANT, spaceId: "space-onboarding" },
      { auth: { authType: "cognito" } } as any,
    );
    expect(mockHasSpaceMemberAccess).toHaveBeenCalledWith(
      { auth: { authType: "cognito" } },
      TENANT,
      "space-onboarding",
    );
    const allConditions = capturedConditions.flat();
    const hasSpace = allConditions.some(
      (c: any) =>
        c?.__eq?.field === threadsTable.space_id &&
        c?.__eq?.value === "space-onboarding",
    );
    const hasUser = allConditions.some(
      (c: any) => c?.__eq?.field === threadsTable.user_id,
    );
    expect(hasSpace).toBe(true);
    expect(hasUser).toBe(false);
  });

  it("returns an empty page when a Cognito caller lacks Space access", async () => {
    mockHasSpaceMemberAccess.mockResolvedValue(false);

    const result = await threadsPaged_query(
      {},
      { tenantId: TENANT, spaceId: "space-locked" },
      { auth: { authType: "cognito" } } as any,
    );

    expect(result).toEqual({ items: [], totalCount: 0 });
    const allConditions = capturedConditions.flat();
    const hasSpace = allConditions.some(
      (c: any) => c?.__eq?.field === threadsTable.space_id,
    );
    expect(hasSpace).toBe(false);
  });

  it("adds a participant unread predicate for global Inbox filters", async () => {
    await threadsPaged_query({}, { tenantId: TENANT, unreadOnly: true }, {
      auth: { authType: "cognito" },
    } as any);

    const allConditions = capturedConditions.flat();
    const sqlConditions = allConditions.filter((c: any) => c?.__sql);
    expect(sqlConditions.length).toBeGreaterThanOrEqual(3);
  });
});
