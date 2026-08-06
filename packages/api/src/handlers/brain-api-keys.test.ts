/**
 * brain-api-keys route behavior: create mints a tkt_ key with suffix +
 * expiry and republishes the manifest; revoke republishes too (a
 * revocation that never reaches the manifest isn't revocation). The grants
 * PATCH (twin-mcp-keys/v2) republishes for the same reason — the platform
 * only ever sees grants through the manifest.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const requireTenantMembership = vi.fn();
const publishTwinKeyManifest = vi.fn();

// vi.mock factories are hoisted above this file's const initializers, and
// the api package's import chain calls getDb() at module load — so the
// mock db must be created inside vi.hoisted.
const { insertReturning, updateWhere, updateReturning, selectRows, db } =
  vi.hoisted(() => {
    const insertReturning = vi.fn();
    const updateWhere = vi.fn();
    const updateReturning = vi.fn();
    const selectRows = vi.fn();
    const db = {
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          returning: () => insertReturning(values),
        }),
      }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          // .where() terminates for revoke and continues to .returning()
          // for the grants PATCH.
          where: (...args: unknown[]) => {
            const result = updateWhere(set, ...args);
            const thenable = Promise.resolve(result) as Promise<unknown> & {
              returning: () => Promise<unknown>;
            };
            thenable.returning = async () => updateReturning(set);
            return thenable;
          },
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
    return { insertReturning, updateWhere, updateReturning, selectRows, db };
  });

vi.mock("@thinkwork/database-pg", () => ({ getDb: () => db }));
vi.mock("../lib/tenant-membership.js", () => ({
  requireTenantMembership: (...args: unknown[]) =>
    requireTenantMembership(...args),
}));
// provision-connector (imported for generateTwinKey) reads the wildcard
// constant from this module at load, so the mock must carry it too.
vi.mock("../lib/twin/key-manifest.js", () => ({
  TWIN_KEY_GRANT_WILDCARD: "*",
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
      security_groups: values.security_groups ?? [],
      kb_collections: values.kb_collections ?? [],
    },
  ]);
  selectRows.mockResolvedValue([]);
  updateWhere.mockResolvedValue(undefined);
  updateReturning.mockImplementation((set: Record<string, unknown>) => [
    {
      id: KEY_ID,
      name: "claude-code",
      security_groups: set.security_groups ?? ["OLD"],
      kb_collections: set.kb_collections ?? ["old-collection"],
    },
  ]);
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
    const stored = insertReturning.mock.calls[0]![0] as Record<string, unknown>;
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

  it("defaults grants to empty — a key minted without them is PUBLIC-only, no KB", async () => {
    await handler(
      event({
        method: "POST",
        path: `/api/tenants/${TENANT}/brain-api-keys`,
        body: { name: "claude-code" },
      }),
    );
    const stored = insertReturning.mock.calls[0]![0] as Record<string, unknown>;
    expect(stored.security_groups).toEqual([]);
    expect(stored.kb_collections).toEqual([]);
  });

  it("stores securityGroups/kbCollections, trimmed and de-duplicated", async () => {
    const res = await handler(
      event({
        method: "POST",
        path: `/api/tenants/${TENANT}/brain-api-keys`,
        body: {
          name: "chatgpt",
          securityGroups: [" FINANCE ", "OPS", "FINANCE"],
          kbCollections: ["handbook"],
        },
      }),
    );
    expect(res.statusCode).toBe(201);
    const stored = insertReturning.mock.calls[0]![0] as Record<string, unknown>;
    expect(stored.security_groups).toEqual(["FINANCE", "OPS"]);
    expect(stored.kb_collections).toEqual(["handbook"]);
    const body = JSON.parse(res.body!);
    expect(body.security_groups).toEqual(["FINANCE", "OPS"]);
    expect(body.kb_collections).toEqual(["handbook"]);
  });

  it('accepts the "*" wildcard grant', async () => {
    const res = await handler(
      event({
        method: "POST",
        path: `/api/tenants/${TENANT}/brain-api-keys`,
        body: { name: "wide", securityGroups: ["*"], kbCollections: ["*"] },
      }),
    );
    expect(res.statusCode).toBe(201);
    const stored = insertReturning.mock.calls[0]![0] as Record<string, unknown>;
    expect(stored.security_groups).toEqual(["*"]);
    expect(stored.kb_collections).toEqual(["*"]);
  });

  it("rejects malformed grant lists", async () => {
    const bad: unknown[] = [
      "FINANCE",
      [""],
      ["  "],
      [1],
      [null],
      ["x".repeat(201)],
      Array.from({ length: 101 }, (_, i) => `g${i}`),
    ];
    for (const securityGroups of bad) {
      const res = await handler(
        event({
          method: "POST",
          path: `/api/tenants/${TENANT}/brain-api-keys`,
          body: { name: "k", securityGroups },
        }),
      );
      expect(res.statusCode).toBe(400);
    }
    expect(insertReturning).not.toHaveBeenCalled();
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

describe("brain-api-keys grants PATCH", () => {
  const path = `/api/tenants/${TENANT}/brain-api-keys/${KEY_ID}`;

  it("updates both grant lists and republishes the manifest", async () => {
    const res = await handler(
      event({
        method: "PATCH",
        path,
        body: { securityGroups: ["FINANCE"], kbCollections: ["handbook"] },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(updateWhere).toHaveBeenCalledWith(
      { security_groups: ["FINANCE"], kb_collections: ["handbook"] },
      expect.anything(),
    );
    const body = JSON.parse(res.body!);
    expect(body.security_groups).toEqual(["FINANCE"]);
    expect(body.kb_collections).toEqual(["handbook"]);
    expect(publishTwinKeyManifest).toHaveBeenCalledWith(TENANT, { db });
  });

  it("only touches the fields present — omission is not a clear", async () => {
    const res = await handler(
      event({ method: "PATCH", path, body: { securityGroups: [] } }),
    );
    expect(res.statusCode).toBe(200);
    expect(updateWhere).toHaveBeenCalledWith(
      { security_groups: [] },
      expect.anything(),
    );
    // kb_collections came back from the row untouched.
    expect(JSON.parse(res.body!).kb_collections).toEqual(["old-collection"]);
  });

  it("requires at least one grant field", async () => {
    const res = await handler(event({ method: "PATCH", path, body: {} }));
    expect(res.statusCode).toBe(400);
    expect(updateWhere).not.toHaveBeenCalled();
    expect(publishTwinKeyManifest).not.toHaveBeenCalled();
  });

  it("rejects a malformed grant list before writing", async () => {
    const res = await handler(
      event({ method: "PATCH", path, body: { kbCollections: [""] } }),
    );
    expect(res.statusCode).toBe(400);
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it("404s when the key belongs to no row of this tenant", async () => {
    updateReturning.mockReturnValue([]);
    const res = await handler(
      event({ method: "PATCH", path, body: { securityGroups: ["FINANCE"] } }),
    );
    expect(res.statusCode).toBe(404);
    expect(publishTwinKeyManifest).not.toHaveBeenCalled();
  });

  it("requires owner/admin", async () => {
    requireTenantMembership.mockResolvedValue({
      ok: false,
      status: 403,
      reason: "Forbidden",
    });
    const res = await handler(
      event({ method: "PATCH", path, body: { securityGroups: ["FINANCE"] } }),
    );
    expect(res.statusCode).toBe(403);
    expect(updateWhere).not.toHaveBeenCalled();
  });
});

/**
 * THINK-626 — `trustedSubsystem` is the right to speak for another human,
 * so it sits behind the PLATFORM trust boundary (shared-secret: CI, the
 * CLI, the provisioning ceremony), not the tenant one. A tenant owner or
 * admin who asks for it is refused loudly rather than silently ignored.
 */
describe("brain-api-keys trustedSubsystem gate", () => {
  const createPath = `/api/tenants/${TENANT}/brain-api-keys`;
  const patchPath = `/api/tenants/${TENANT}/brain-api-keys/${KEY_ID}`;

  function asOperator() {
    requireTenantMembership.mockResolvedValue({
      ok: true,
      tenantId: TENANT,
      userId: null,
      role: null,
      auth: { authType: "apikey" },
    });
  }

  function asTenantAdmin() {
    requireTenantMembership.mockResolvedValue({
      ok: true,
      tenantId: TENANT,
      userId: "user-1",
      role: "admin",
      auth: { authType: "cognito" },
    });
  }

  it("an operator may mint a trusted-subsystem key", async () => {
    asOperator();
    const res = await handler(
      event({
        method: "POST",
        path: createPath,
        body: { name: "pi-runtime", trustedSubsystem: true },
      }),
    );
    expect(res.statusCode).toBe(201);
    expect(insertReturning).toHaveBeenCalledWith(
      expect.objectContaining({ trusted_subsystem: true }),
    );
    expect(JSON.parse(res.body!).trusted_subsystem).toBe(true);
  });

  it("keys are born untrusted when the field is omitted", async () => {
    asOperator();
    const res = await handler(
      event({ method: "POST", path: createPath, body: { name: "chatgpt" } }),
    );
    expect(res.statusCode).toBe(201);
    expect(insertReturning).toHaveBeenCalledWith(
      expect.objectContaining({ trusted_subsystem: false }),
    );
  });

  it("a tenant admin asking for it is refused 403, and nothing is written", async () => {
    asTenantAdmin();
    const res = await handler(
      event({
        method: "POST",
        path: createPath,
        body: { name: "chatgpt", trustedSubsystem: true },
      }),
    );
    expect(res.statusCode).toBe(403);
    expect(insertReturning).not.toHaveBeenCalled();
  });

  it("an operator may turn the flag back off via PATCH", async () => {
    asOperator();
    const res = await handler(
      event({
        method: "PATCH",
        path: patchPath,
        body: { trustedSubsystem: false },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(updateWhere).toHaveBeenCalledWith(
      { trusted_subsystem: false },
      expect.anything(),
    );
    // The platform sees the flag only through the manifest.
    expect(publishTwinKeyManifest).toHaveBeenCalledWith(TENANT, { db });
  });

  it("a tenant admin cannot PATCH the flag", async () => {
    asTenantAdmin();
    const res = await handler(
      event({
        method: "PATCH",
        path: patchPath,
        body: { trustedSubsystem: true },
      }),
    );
    expect(res.statusCode).toBe(403);
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean value with 400 even from an operator", async () => {
    asOperator();
    const res = await handler(
      event({
        method: "PATCH",
        path: patchPath,
        body: { trustedSubsystem: "yes" },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(updateWhere).not.toHaveBeenCalled();
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
