/**
 * plugin-staging-sweeper tests (plan §U10).
 *
 * Verifies the UPDATE shape and S3 deletion semantics without hitting AWS.
 * The actual SQL predicate is exercised indirectly by the mocked drizzle
 * chain — an integration test against a real Aurora is a follow-up.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSelectOrphans, mockUpdateReturning, mockS3Send } = vi.hoisted(
  () => ({
    mockSelectOrphans: vi.fn(),
    mockUpdateReturning: vi.fn(),
    mockS3Send: vi.fn(),
  }),
);

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectOrphans()),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockUpdateReturning() ?? []),
        }),
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  pluginUploads: {
    id: "pluginUploads.id",
    tenant_id: "pluginUploads.tenant_id",
    status: "pluginUploads.status",
    uploaded_at: "pluginUploads.uploaded_at",
    s3_staging_prefix: "pluginUploads.s3_staging_prefix",
    error_message: "pluginUploads.error_message",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
  inArray: (col: unknown, vals: unknown[]) => ({ _inArray: [col, vals] }),
  lt: (col: unknown, val: unknown) => ({ _lt: [col, val] }),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3ClientMock {
    send = mockS3Send;
  }
  class ListObjectsV2CommandMock {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class DeleteObjectsCommandMock {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    S3Client: S3ClientMock,
    ListObjectsV2Command: ListObjectsV2CommandMock,
    DeleteObjectsCommand: DeleteObjectsCommandMock,
  };
});

// eslint-disable-next-line import/first
import { handler } from "../handlers/plugin-staging-sweeper.js";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WORKSPACE_BUCKET = "test-bucket";
  mockSelectOrphans.mockReturnValue([]);
  mockUpdateReturning.mockReturnValue([]);
});

describe("plugin-staging-sweeper", () => {
  it("no-op when bucket has no stale staging rows", async () => {
    mockSelectOrphans.mockReturnValue([]);
    const result = await handler();
    expect(result.orphans).toBe(0);
    expect(result.deleted_keys).toBe(0);
    expect(result.rows_marked_failed).toBe(0);
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("deletes S3 prefix + marks row failed when orphan exists", async () => {
    mockSelectOrphans.mockReturnValue([
      {
        id: "u1",
        tenant_id: "t1",
        s3_staging_prefix: "tenants/t1/_plugin-uploads/u1/",
      },
    ]);
    mockUpdateReturning.mockReturnValue([{ id: "u1" }]);

    // S3 list returns one object; delete swallows it.
    mockS3Send.mockImplementation(async (cmd: { input: unknown }) => {
      const input = cmd.input as { Prefix?: string };
      if (input.Prefix) {
        return {
          Contents: [{ Key: `${input.Prefix}bundle.zip` }],
          IsTruncated: false,
        };
      }
      return {};
    });

    const result = await handler();
    expect(result.orphans).toBe(1);
    expect(result.deleted_keys).toBe(1);
    expect(result.rows_marked_failed).toBe(1);
    expect(result.rows[0]).toMatchObject({
      id: "u1",
      tenant_id: "t1",
      deleted_key_count: 1,
    });
    // ListObjectsV2 + DeleteObjects both called.
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it("walks continuation tokens for prefixes with >1000 keys", async () => {
    mockSelectOrphans.mockReturnValue([
      {
        id: "u2",
        tenant_id: "t2",
        s3_staging_prefix: "tenants/t2/_plugin-uploads/u2/",
      },
    ]);

    let page = 0;
    mockS3Send.mockImplementation(async (cmd: { input: unknown }) => {
      const input = cmd.input as { Prefix?: string; Delete?: unknown };
      if (input.Prefix) {
        page += 1;
        if (page === 1) {
          return {
            Contents: [{ Key: "a" }, { Key: "b" }],
            IsTruncated: true,
            NextContinuationToken: "tok1",
          };
        }
        return {
          Contents: [{ Key: "c" }],
          IsTruncated: false,
        };
      }
      // Delete response — no Contents-like shape needed.
      return {};
    });

    const result = await handler();
    expect(result.rows[0]!.deleted_key_count).toBe(3);
  });

  it("handles row with null staging prefix without crashing", async () => {
    mockSelectOrphans.mockReturnValue([
      { id: "u3", tenant_id: "t3", s3_staging_prefix: null },
    ]);
    const result = await handler();
    expect(result.rows[0]).toMatchObject({
      id: "u3",
      s3_staging_prefix: null,
      deleted_key_count: 0,
    });
    // No S3 calls because prefix was null.
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("throws when WORKSPACE_BUCKET is missing", async () => {
    delete process.env.WORKSPACE_BUCKET;
    await expect(handler()).rejects.toThrow("WORKSPACE_BUCKET");
  });
});
