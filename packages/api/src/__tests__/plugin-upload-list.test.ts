/**
 * plugin-upload GET /api/plugins + GET /api/plugins/:uploadId tests.
 *
 * The existing plugin-upload.test.ts covers OPTIONS, auth, presign, and
 * the install saga; this file keeps the list/detail endpoint shape + the
 * cross-tenant isolation invariant in a dedicated suite so the db mock
 * doesn't have to satisfy two very different call patterns.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuthenticate, mockMemberRows, mockListRows, mockDetailRow } =
  vi.hoisted(() => ({
    mockAuthenticate: vi.fn(),
    mockMemberRows: vi.fn(),
    mockListRows: vi.fn(),
    mockDetailRow: vi.fn(),
  }));

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: mockAuthenticate,
}));

// db.select is called twice per request on the detail path (admin check
// first, then the row lookup). Route by call order: the first .limit() in
// a test returns the admin member rows, subsequent ones return the detail
// row the test queued. List path has its own .orderBy().limit() branch.
let _limitCallCount = 0;
vi.mock("@thinkwork/database-pg", () => {
  const chainBase = () => ({
    from: () => ({
      where: () => ({
        limit: () => {
          _limitCallCount += 1;
          if (_limitCallCount === 1) {
            return Promise.resolve(mockMemberRows() as unknown[]);
          }
          const detail = mockDetailRow();
          return Promise.resolve(detail ? [detail] : []);
        },
        orderBy: () => ({
          limit: () => Promise.resolve(mockListRows() as unknown[]),
        }),
      }),
    }),
  });
  return {
    getDb: () => ({
      select: chainBase,
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve([{ id: "x" }]) }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    }),
  };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
  pluginUploads: {
    id: "pluginUploads.id",
    tenant_id: "pluginUploads.tenant_id",
    uploaded_by: "pluginUploads.uploaded_by",
    uploaded_at: "pluginUploads.uploaded_at",
    bundle_sha256: "pluginUploads.bundle_sha256",
    plugin_name: "pluginUploads.plugin_name",
    plugin_version: "pluginUploads.plugin_version",
    status: "pluginUploads.status",
    s3_staging_prefix: "pluginUploads.s3_staging_prefix",
    error_message: "pluginUploads.error_message",
  },
  tenantMcpServers: {},
  tenantMembers: {
    tenant_id: "tenantMembers.tenant_id",
    principal_id: "tenantMembers.principal_id",
    role: "tenantMembers.role",
  },
  tenantSkills: {},
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _and: args }),
  eq: (...args: unknown[]) => ({ _eq: args }),
  desc: (col: unknown) => ({ _desc: col }),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3ClientMock {
    async send() {
      return {};
    }
  }
  return {
    S3Client: S3ClientMock,
    GetObjectCommand: class {},
    PutObjectCommand: class {},
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

// eslint-disable-next-line import/first
import { handler } from "../handlers/plugin-upload.js";

function ev(path: string, method = "GET"): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    requestContext: { http: { method, path } },
    headers: { authorization: "Bearer token" },
    body: null,
  } as unknown as APIGatewayProxyEventV2;
}

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const UPLOAD_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  vi.clearAllMocks();
  _limitCallCount = 0;
  process.env.WORKSPACE_BUCKET = "bucket";
  mockAuthenticate.mockResolvedValue({
    authType: "cognito",
    principalId: "admin-user",
    tenantId: TENANT_A,
    email: null,
    agentId: null,
  });
  mockMemberRows.mockReturnValue([{ role: "admin" }]);
  mockListRows.mockReturnValue([]);
  mockDetailRow.mockReturnValue(undefined);
});

describe("GET /api/plugins", () => {
  it("returns upload history for the caller's tenant", async () => {
    const rows = [
      {
        id: UPLOAD_ID,
        uploaded_by: "admin-user",
        uploaded_at: new Date("2026-04-24T00:00:00Z"),
        bundle_sha256: "abc",
        plugin_name: "my-plugin",
        plugin_version: "1.0.0",
        status: "installed",
        error_message: null,
      },
    ];
    mockListRows.mockReturnValue(rows);
    const res = await handler(ev("/api/plugins"));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.uploads).toHaveLength(1);
    expect(body.uploads[0].id).toBe(UPLOAD_ID);
  });

  it("401 without auth", async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await handler(ev("/api/plugins"));
    expect(res.statusCode).toBe(401);
  });

  it("403 when caller is not admin", async () => {
    mockMemberRows.mockReturnValue([{ role: "member" }]);
    const res = await handler(ev("/api/plugins"));
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /api/plugins/:uploadId", () => {
  it("returns detail when row belongs to caller's tenant", async () => {
    mockDetailRow.mockReturnValue({
      id: UPLOAD_ID,
      tenant_id: TENANT_A,
      uploaded_by: "admin-user",
      uploaded_at: new Date("2026-04-24T00:00:00Z"),
      bundle_sha256: "abc",
      plugin_name: "my-plugin",
      plugin_version: null,
      status: "installed",
      s3_staging_prefix: null,
      error_message: null,
    });
    const res = await handler(ev(`/api/plugins/${UPLOAD_ID}`));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.upload.id).toBe(UPLOAD_ID);
    // Tenant id is stripped from response to avoid accidental leakage.
    expect(body.upload.tenant_id).toBeUndefined();
  });

  it("404 when row belongs to a different tenant (tenant isolation)", async () => {
    mockDetailRow.mockReturnValue({
      id: UPLOAD_ID,
      tenant_id: TENANT_B,
      uploaded_by: null,
      uploaded_at: new Date(),
      bundle_sha256: "abc",
      plugin_name: "foreign",
      plugin_version: null,
      status: "installed",
      s3_staging_prefix: null,
      error_message: null,
    });
    const res = await handler(ev(`/api/plugins/${UPLOAD_ID}`));
    expect(res.statusCode).toBe(404);
  });

  it("404 when row does not exist", async () => {
    mockDetailRow.mockReturnValue(null);
    const res = await handler(ev(`/api/plugins/${UPLOAD_ID}`));
    expect(res.statusCode).toBe(404);
  });
});
