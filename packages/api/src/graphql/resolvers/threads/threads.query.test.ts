import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  capturedConditions,
  mockDb,
  mockEq,
  mockAnd,
  mockSql,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  threadsTable,
} = vi.hoisted(() => {
  const captured: unknown[][] = [];
  const col = (label: string) => ({ __col: label });
  const threads = {
    id: col("threads.id"),
    tenant_id: col("threads.tenant_id"),
    agent_id: col("threads.agent_id"),
    assignee_id: col("threads.assignee_id"),
    channel: col("threads.channel"),
    status: col("threads.status"),
    title: col("threads.title"),
    identifier: col("threads.identifier"),
    description: col("threads.description"),
    created_at: col("threads.created_at"),
    metadata: col("threads.metadata"),
    space_id: col("threads.space_id"),
  };
  return {
    capturedConditions: captured,
    threadsTable: threads,
    mockEq: vi.fn((field: unknown, value: unknown) => ({
      __eq: { field, value },
    })),
    mockAnd: vi.fn((...conditions: unknown[]) => {
      captured.push(conditions);
      return { __and: conditions };
    }),
    mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      __sql: { text: strings.join("?"), values },
    })),
    mockResolveCallerTenantId: vi.fn(async () => "tenant-a" as string | null),
    mockResolveCallerUserId: vi.fn(async () => "user-a" as string | null),
    mockDb: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => []),
            })),
          })),
        })),
      })),
    },
  };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: mockEq,
  and: mockAnd,
  desc: vi.fn((field: unknown) => ({ __desc: field })),
  sql: mockSql,
  threads: threadsTable,
  threadToCamel: (row: unknown) => row,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

import { threads_query } from "./threads.query.js";

beforeEach(() => {
  capturedConditions.length = 0;
  mockResolveCallerTenantId.mockReset().mockResolvedValue("tenant-a");
  mockResolveCallerUserId.mockReset().mockResolvedValue("user-a");
});

describe("threads query", () => {
  it("excludes system-hidden automation builder threads from normal lists", async () => {
    await threads_query({}, { tenantId: "tenant-a" }, {
      auth: { authType: "apikey" },
    } as any);

    const allConditions = capturedConditions.flat();
    const hiddenPredicate = allConditions.find(
      (condition: any) =>
        condition?.__sql?.text?.includes("systemHidden") &&
        condition?.__sql?.text?.includes("automation_builder"),
    );
    expect(hiddenPredicate).toBeTruthy();
  });
});
