/**
 * brain-api-keys route behavior: create mints a tkt_ key with suffix +
 * expiry and republishes the manifest; revoke republishes too (a
 * revocation that never reaches the manifest isn't revocation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const requireTenantMembership = vi.fn();
const publishTwinKeyManifest = vi.fn();

// vi.mock factories are hoisted above this file's const initializers, and
// the api package's import chain calls getDb() at module load — so the
// mock db must be created inside vi.hoisted.
const { insertReturning, updateWhere, selectRows, db } = vi.hoisted(() => {
  const insertReturning = vi.fn();
  const updateWhere = vi.fn();
  const selectRows = vi.fn();
  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => insertReturning(values),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (...args: unknown[]) => updateWhere(set, ...args),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => selectRows(),
        }),
      }),
    }),
  };
  return { insertReturning, updateWhere, selectRows, db };
});

vi.mock("@thinkwork/database-pg", () => ({ getDb: () => db }));
vi.mock("../lib/tenant-membership.js", () => ({
  requireTenantMembership: (...args: unknown[]) =>
    requireTenantMembership(...args),
}));
vi.mock("../lib/twin/key-manifest.js", () => ({
  publishTwinKeyManifest: (...args: unknown[]) =>
    publishTwinKeyManifest(...args),
}));

import { handler, KEY_SUFFIX_CHARS } from "./brain-api-keys.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const KEY_ID = "22222222-2222-2222-2222-222222222222";

function event(input: {
  method: string;
  path: string;
  body?: unknown;
}): APIGatewayProxyEventV2 {
  return {
    rawPath: input.path,
    headers: {},
    requestContext: { http: { method: input.method } },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantMembership.mockResolvedValue({
    ok: true,
    tenantId: TENANT,
    userId: "user-1",
  });
  publishTwinKeyManifest.mockResolvedValue({ published: true, keyCount: 2 });
  insertReturning.mockImplementation((values: Record<string, unknown>) => [
    {
      id: KEY_ID,
      name: values.name,
      created_at: new Date("2026-07-28T00:00:00Z"),
      expires_at: values.expires_at ?? null,
    },
  ]);
  selectRows.mockResolvedValue([]);
  updateWhere.mockResolvedValue(undefined);
});

describe("brain-api-keys create", () => {
  it("mints a tkt_ key, stores the last-8 suffix, returns the raw once, republishes manifest", async () => {
    const res = await handler(
      event({
        method: "POST",
        path: `/api/tenants/${TENANT}/brain-api-keys`,
        body: { name: "claude-code" },
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body!);
    expect(body.token.startsWith("tkt_")).toBe(true);
    expect(body.key_suffix).toBe(body.token.slice(-KEY_SUFFIX_CHARS));
    expect(body.expires_at).toBeNull();
    expect(body.keyManifest).toEqual({ published: true, keyCount: 2 });
    // The insert stored the hash + suffix, never the raw token.
    const stored = insertReturning.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(stored.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.key_suffix).toBe(body.key_suffix);
    expect(JSON.stringify(stored)).not.toContain(body.token);
    expect(publishTwinKeyManifest).toHaveBeenCalledWith(TENANT, { db });
  });

  it("expiresInDays sets expires_at in the future", async () => {
    const res = await handler(
      event({
        method: "POST",
        path: `/api/tenants/${TENANT}/brain-api-keys`,
        body: { name: "temp", expiresInDays: 30 },
      }),
    );
    expect(res.statusCode).toBe(201);
    const stored = insertReturning.mock.calls[0]![0] as {
      expires_at: Date | null;
    };
    expect(stored.expires_at).toBeInstanceOf(Date);
    const days =
      (stored.expires_at!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it("rejects empty, oversized, and reserved names", async () => {
    for (const name of ["", "   ", "x".repeat(101), "default"]) {
      const res = await handler(
        event({
          method: "POST",
          path: `/api/tenants/${TENANT}/brain-api-keys`,
          body: { name },
        }),
      );
      expect(res.statusCode).toBe(400);
    }
    expect(insertReturning).not.toHaveBeenCalled();
  });

  it("rejects non-positive and absurd expiresInDays", async () => {
    for (const expiresInDays of [0, -5, 99999, "soon"]) {
      const res = await handler(
        event({
          method: "POST",
          path: `/api/tenants/${TENANT}/brain-api-keys`,
          body: { name: "k", expiresInDays },
        }),
      );
      expect(res.statusCode).toBe(400);
    }
  });

  it("maps the active-name unique violation to 409", async () => {
    insertReturning.mockImplementation(() => {
      throw new Error(
        'duplicate key value violates unique constraint "uq_tenant_mcp_twin_keys_active_name"',
      );
    });
    const res = await handler(
      event({
        method: "POST",
        path: `/api/tenants/${TENANT}/brain-api-keys`,
        body: { name: "dupe" },
      }),
    );
    expect(res.statusCode).toBe(409);
  });

  it("mutations require owner/admin; failed membership is surfaced", async () => {
    requireTenantMembership.mockResolvedValue({
      ok: false,
      status: 403,
      reason: "Forbidden",
    });
    const res = await handler(
      event({
        method: "POST",
        path: `/api/tenants/${TENANT}/brain-api-keys`,
        body: { name: "k" },
      }),
    );
    expect(res.statusCode).toBe(403);
    expect(requireTenantMembership).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      { requiredRoles: ["owner", "admin"] },
    );
  });
});

describe("brain-api-keys list", () => {
  it("lists metadata with a member-level bar", async () => {
    selectRows.mockResolvedValue([
      { id: KEY_ID, name: "k", key_suffix: "abcd1234" },
    ]);
    const res = await handler(
      event({ method: "GET", path: `/api/tenants/${TENANT}/brain-api-keys` }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!).keys).toHaveLength(1);
    expect(requireTenantMembership).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      { requiredRoles: ["owner", "admin", "member"] },
    );
  });
});

describe("brain-api-keys revoke", () => {
  it("revokes and republishes the manifest", async () => {
    const res = await handler(
      event({
        method: "DELETE",
        path: `/api/tenants/${TENANT}/brain-api-keys/${KEY_ID}`,
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(updateWhere).toHaveBeenCalledWith(
      expect.objectContaining({ revoked_at: expect.any(Date) }),
      expect.anything(),
    );
    expect(publishTwinKeyManifest).toHaveBeenCalledWith(TENANT, { db });
  });

  it("rejects a non-UUID key id before touching auth or the db", async () => {
    const res = await handler(
      event({
        method: "DELETE",
        path: `/api/tenants/${TENANT}/brain-api-keys/not-a-uuid`,
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(updateWhere).not.toHaveBeenCalled();
  });
});
