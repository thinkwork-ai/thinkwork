import { beforeEach, describe, expect, it, vi } from "vitest";

const { captures, mockDb, mockReadThreadProgressMarkdown, tables } = vi.hoisted(
  () => {
    const tables = {
      tenants: {
        id: { __column__: "tenants.id" },
        slug: { __column__: "tenants.slug" },
        __table__: "tenants",
      },
      threads: {
        id: { __column__: "threads.id" },
        tenant_id: { __column__: "threads.tenant_id" },
        __table__: "threads",
      },
    };
    const captures = {
      tenantRows: [] as Record<string, unknown>[],
      threadRows: [] as Record<string, unknown>[],
    };
    const rowsFor = (table: any) => {
      if (table === tables.tenants) return captures.tenantRows;
      if (table === tables.threads) return captures.threadRows;
      return [];
    };
    const db = {
      select: vi.fn(() => ({
        from: vi.fn((table: any) => ({
          where: vi.fn(async () => rowsFor(table)),
        })),
      })),
    };

    return {
      captures,
      mockDb: db,
      mockReadThreadProgressMarkdown: vi.fn(),
      tables,
    };
  },
);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    and: vi.fn((...conditions: unknown[]) => ({ conditions })),
    db: mockDb,
    eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    tenants: tables.tenants,
    threads: tables.threads,
  };
});

vi.mock("../../../lib/thread-progress/storage.js", () => ({
  readThreadProgressMarkdown: mockReadThreadProgressMarkdown,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: vi.fn(async () => "tenant-1"),
  resolveCallerUserId: vi.fn(async () => "user-1"),
}));

vi.mock("./access.js", () => ({
  callerVisibleThreadPredicate: vi.fn(() => ({ visible: true })),
}));

import { threadProgress } from "./threadProgress.query.js";

const ctx = {
  auth: {
    authType: "cognito",
  },
} as any;

beforeEach(() => {
  captures.tenantRows.length = 0;
  captures.threadRows.length = 0;
  mockDb.select.mockClear();
  mockReadThreadProgressMarkdown.mockReset();
});

describe("threadProgress", () => {
  it("reads tenant-scoped PROGRESS.md for visible threads", async () => {
    captures.threadRows.push({ id: "thread-1", tenant_id: "tenant-1" });
    captures.tenantRows.push({ slug: "acme" });
    mockReadThreadProgressMarkdown.mockResolvedValue("# PROGRESS\n\n## Tasks");

    await expect(
      threadProgress(null, { tenantId: "tenant-1", threadId: "thread-1" }, ctx),
    ).resolves.toEqual({
      threadId: "thread-1",
      markdown: "# PROGRESS\n\n## Tasks",
    });
    expect(mockReadThreadProgressMarkdown).toHaveBeenCalledWith({
      tenantSlug: "acme",
      threadId: "thread-1",
    });
  });

  it("returns null when PROGRESS.md is absent", async () => {
    captures.threadRows.push({ id: "thread-1", tenant_id: "tenant-1" });
    captures.tenantRows.push({ slug: "acme" });
    mockReadThreadProgressMarkdown.mockResolvedValue(null);

    await expect(
      threadProgress(null, { tenantId: "tenant-1", threadId: "thread-1" }, ctx),
    ).resolves.toBeNull();
  });
});
