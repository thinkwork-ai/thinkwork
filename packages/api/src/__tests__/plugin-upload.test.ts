/**
 * Plugin-upload REST handler tests.
 *
 * The handler composes: auth → admin-role DB check → presign / saga.
 * We mock every external edge (cognito-auth, drizzle, aws-sdk) at the
 * module level so tests exercise the handler's routing + error paths
 * without a live Lambda invoke path.
 */

import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — see vi.hoisted docs for why the handles get closed
// over here instead of redefined per-test.
// ---------------------------------------------------------------------------

const {
  mockAuthenticate,
  mockMemberRows,
  mockValidatePluginZip,
  mockRunInstallSaga,
  mockDownloadS3Object,
  mockGetSignedUrl,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockMemberRows: vi.fn(),
  mockValidatePluginZip: vi.fn(),
  mockRunInstallSaga: vi.fn(),
  mockDownloadS3Object: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: mockAuthenticate,
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockMemberRows() as unknown[]),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([{ id: "upload-1" }]),
        onConflictDoNothing: () => Promise.resolve(),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  pluginUploads: { id: "pluginUploads.id" },
  tenantMcpServers: {},
  tenantMembers: {
    tenant_id: "tenantMembers.tenant_id",
    principal_id: "tenantMembers.principal_id",
    role: "tenantMembers.role",
  },
  tenantSkills: {},
}));

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => ({ _and: _args }),
  eq: (..._args: unknown[]) => ({ _eq: _args }),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3ClientMock {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    async send(_cmd: any) {
      return {};
    }
  }
  class GetObjectCommandMock {}
  class PutObjectCommandMock {}
  return {
    S3Client: S3ClientMock,
    GetObjectCommand: GetObjectCommandMock,
    PutObjectCommand: PutObjectCommandMock,
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock("../lib/plugin-validator.js", () => ({
  validatePluginZip: mockValidatePluginZip,
}));

vi.mock("../lib/plugin-installer.js", async () => {
  // Preserve sha256Hex (pure) so the handler's hash computation still
  // runs against its real implementation.
  const actual = await vi.importActual<
    typeof import("../lib/plugin-installer.js")
  >("../lib/plugin-installer.js");
  return {
    ...actual,
    runPluginInstallSaga: mockRunInstallSaga,
  };
});

// The handler reads the S3 body by iterating an AsyncIterable. Rather
// than stand up the whole Body shape, we patch the download helper's
// single caller by overriding GetObjectCommand's response at the mock
// client layer — since our S3 mock returns `{}`, we stub the handler's
// downloadS3Object via the helper module. Simpler route: replace Body
// with an async generator the handler walks.
// eslint-disable-next-line import/first
import { handler } from "../handlers/plugin-upload.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: {
  method?: string;
  path?: string;
  body?: string | null;
  headers?: Record<string, string>;
}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: overrides.path ?? "/api/plugins/upload",
    rawQueryString: "",
    headers: overrides.headers ?? {},
    requestContext: {
      accountId: "1",
      apiId: "1",
      domainName: "test",
      domainPrefix: "test",
      http: {
        method: overrides.method ?? "POST",
        path: overrides.path ?? "/api/plugins/upload",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "r",
      routeKey: "$default",
      stage: "$default",
      time: "now",
      timeEpoch: 0,
    },
    body: overrides.body ?? null,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

beforeEach(() => {
  process.env.WORKSPACE_BUCKET = "test-bucket";
  mockAuthenticate.mockReset();
  mockMemberRows.mockReset();
  mockValidatePluginZip.mockReset();
  mockRunInstallSaga.mockReset();
  mockDownloadS3Object.mockReset();
  mockGetSignedUrl.mockReset();
});

// ---------------------------------------------------------------------------
// OPTIONS — no auth, no DB
// ---------------------------------------------------------------------------

describe("plugin-upload handler — OPTIONS preflight", () => {
  it("returns 204 with CORS headers and does NOT call authenticate", async () => {
    const res = await handler(makeEvent({ method: "OPTIONS" }));

    expect(res.statusCode).toBe(204);
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(mockMemberRows).not.toHaveBeenCalled();
    const accessHeader = Object.entries(res.headers ?? {}).find(
      ([k]) => k.toLowerCase() === "access-control-allow-origin",
    );
    expect(accessHeader).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Auth + admin-role gate
// ---------------------------------------------------------------------------

describe("plugin-upload handler — auth gate", () => {
  it("returns 401 when authenticate() returns null", async () => {
    mockAuthenticate.mockResolvedValueOnce(null);
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when auth carries no tenant_id", async () => {
    mockAuthenticate.mockResolvedValueOnce({
      principalId: "u1",
      tenantId: null,
      email: null,
      authType: "cognito",
      agentId: null,
    });
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body ?? "{}").error).toMatch(/tenant_id/);
  });

  it("returns 403 when caller role is not owner or admin", async () => {
    mockAuthenticate.mockResolvedValueOnce({
      principalId: "u1",
      tenantId: "tenant-a",
      email: null,
      authType: "cognito",
      agentId: null,
    });
    mockMemberRows.mockReturnValueOnce([{ role: "member" }]);
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when the caller is not a member of the tenant at all", async () => {
    mockAuthenticate.mockResolvedValueOnce({
      principalId: "u1",
      tenantId: "tenant-a",
      email: null,
      authType: "cognito",
      agentId: null,
    });
    mockMemberRows.mockReturnValueOnce([]); // no rows
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Presign route
// ---------------------------------------------------------------------------

describe("plugin-upload handler — POST /api/plugins/presign", () => {
  it("returns a presigned upload URL + s3Key under the tenant staging prefix", async () => {
    mockAuthenticate.mockResolvedValueOnce({
      principalId: "u1",
      tenantId: "tenant-a",
      email: null,
      authType: "cognito",
      agentId: null,
    });
    mockMemberRows.mockReturnValueOnce([{ role: "admin" }]);
    mockGetSignedUrl.mockResolvedValueOnce("https://presigned.example/put");

    const res = await handler(
      makeEvent({
        path: "/api/plugins/presign",
        body: JSON.stringify({ fileName: "my-plugin.zip" }),
      }),
    );
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body ?? "{}");
    expect(parsed.uploadUrl).toBe("https://presigned.example/put");
    // Staging key must live under the tenant's own prefix — cross-tenant
    // scope is what the /upload route verifies, presign establishes it.
    expect(parsed.s3Key).toMatch(/^tenants\/tenant-a\/_plugin-uploads\//);
    expect(parsed.expiresIn).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Upload route — routing + validation error paths
// ---------------------------------------------------------------------------

describe("plugin-upload handler — POST /api/plugins/upload", () => {
  function authedAdmin() {
    mockAuthenticate.mockResolvedValue({
      principalId: "u1",
      tenantId: "tenant-a",
      email: null,
      authType: "cognito",
      agentId: null,
    });
    mockMemberRows.mockReturnValue([{ role: "owner" }]);
  }

  it("returns 400 when body is missing s3Key", async () => {
    authedAdmin();
    const res = await handler(
      makeEvent({ path: "/api/plugins/upload", body: JSON.stringify({}) }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body ?? "{}").error).toMatch(/s3Key/);
  });

  it("returns 403 when s3Key points outside the caller's tenant staging prefix", async () => {
    authedAdmin();
    const res = await handler(
      makeEvent({
        path: "/api/plugins/upload",
        body: JSON.stringify({
          s3Key: "tenants/OTHER-TENANT/_plugin-uploads/abc/bundle.zip",
        }),
      }),
    );
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Method enforcement
// ---------------------------------------------------------------------------

describe("plugin-upload handler — method enforcement", () => {
  it("returns 405 for a GET request (auth still runs first)", async () => {
    mockAuthenticate.mockResolvedValueOnce({
      principalId: "u1",
      tenantId: "tenant-a",
      email: null,
      authType: "cognito",
      agentId: null,
    });
    const res = await handler(
      makeEvent({ method: "GET", path: "/api/plugins/upload" }),
    );
    expect(res.statusCode).toBe(405);
  });
});
