/**
 * External confidential capability client resolvers (THINK-280 U8).
 *
 * Covers: operator gating, one-to-one active-service-principal binding,
 * reveal-secret-once (create + rotate) with only the slow hash stored,
 * capabilities-only scope, idempotent revocation, forged-tenant isolation,
 * and audit emission on applied outcomes only.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rowsQueue,
  writeOps,
  mockRequireAdminOrServiceCaller,
  mockResolveCallerUserId,
  mockEmitAuditEvent,
} = vi.hoisted(() => ({
  rowsQueue: [] as unknown[][],
  writeOps: [] as Array<{ op: string; args: unknown }>,
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockEmitAuditEvent: vi.fn(),
}));

function takeRows(): unknown[] {
  return rowsQueue.shift() ?? [];
}
function selectChain() {
  const promise = Promise.resolve(takeRows());
  return {
    limit: () => promise,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectChain() }) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: () => {
          writeOps.push({ op: "insert", args: { table, values } });
          return Promise.resolve(takeRows());
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: () => {
            writeOps.push({ op: "update", args: { table, values } });
            return Promise.resolve(takeRows());
          },
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ label: "tx" }),
  },
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  capabilityExternalClients: {
    id: "capabilityExternalClients.id",
    tenant_id: "capabilityExternalClients.tenant_id",
    client_id: "capabilityExternalClients.client_id",
    status: "capabilityExternalClients.status",
  },
  tenantServicePrincipals: {
    id: "tenantServicePrincipals.id",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));
vi.mock("../../../lib/compliance/emit.js", () => ({
  emitAuditEvent: mockEmitAuditEvent,
}));
vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string) =>
    key === "MCP_OAUTH_CALLBACK_URL"
      ? "https://api.test/mcp/oauth/callback"
      : undefined,
}));

import {
  createExternalCapabilityClient,
  rotateExternalCapabilityClient,
  revokeExternalCapabilityClient,
  externalCapabilityClients,
} from "./externalCapabilityClient.mutations.js";
import { verifyClientSecret } from "../../../lib/mcp-oauth/client-secret.js";
import type { GraphQLContext } from "../../context.js";

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SP_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const USER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const ctx = {} as GraphQLContext;

function activeSp() {
  return {
    id: SP_ID,
    tenant_id: TENANT_A,
    slug: "gh-bot",
    status: "active",
    created_at: new Date(),
    revoked_at: null,
  };
}
function clientRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "client-row-1",
    tenant_id: TENANT_A,
    client_id: "twcap_abc",
    client_secret_hash: "scrypt$stored",
    service_principal_id: SP_ID,
    allowed_resource: "https://api.test/mcp/capabilities",
    allowed_scopes_json: ["capabilities:search"],
    status: "active",
    created_at: new Date(),
    rotated_at: null,
    revoked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  rowsQueue.length = 0;
  writeOps.length = 0;
  vi.clearAllMocks();
  mockResolveCallerUserId.mockResolvedValue(USER_ID);
});

describe("createExternalCapabilityClient", () => {
  it("mints a client for an active SP, reveals the secret once, stores only the hash", async () => {
    rowsQueue.push([activeSp()]); // loadActivePrincipal
    rowsQueue.push([clientRow()]); // insert .returning()
    const result = await createExternalCapabilityClient(
      {},
      { input: { tenantId: TENANT_A, servicePrincipalId: SP_ID } },
      ctx,
    );
    expect(result.outcome).toBe("applied");
    const client = result.client as Record<string, unknown>;
    // Secret revealed once, real value.
    expect(typeof client.clientSecret).toBe("string");
    expect(client.clientSecret).toMatch(/^twcs_/);
    expect(client.allowedScopes).toEqual(["capabilities:search"]);
    // Only the hash is persisted — never the plaintext.
    const insert = writeOps.find((w) => w.op === "insert")!;
    const values = (insert.args as { values: Record<string, unknown> }).values;
    expect(values.client_secret_hash).toMatch(/^scrypt\$/);
    expect(values.client_secret_hash).not.toContain(
      client.clientSecret as string,
    );
    // The stored hash verifies against the revealed secret.
    expect(
      verifyClientSecret(
        client.clientSecret as string,
        values.client_secret_hash as string,
      ),
    ).toBe(true);
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects when the service principal is not active", async () => {
    rowsQueue.push([{ ...activeSp(), status: "revoked" }]);
    const result = await createExternalCapabilityClient(
      {},
      { input: { tenantId: TENANT_A, servicePrincipalId: SP_ID } },
      ctx,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toBe("service_principal_not_active");
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a service principal from another tenant (forged tenant isolation)", async () => {
    rowsQueue.push([{ ...activeSp(), tenant_id: TENANT_B }]);
    const result = await createExternalCapabilityClient(
      {},
      { input: { tenantId: TENANT_A, servicePrincipalId: SP_ID } },
      ctx,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toBe("service_principal_not_active");
  });
});

describe("rotateExternalCapabilityClient", () => {
  it("regenerates the secret (revealed once) and stamps rotated_at", async () => {
    rowsQueue.push([clientRow()]); // load
    rowsQueue.push([clientRow({ rotated_at: new Date() })]); // update returning
    const result = await rotateExternalCapabilityClient(
      {},
      { tenantId: TENANT_A, clientId: "twcap_abc" },
      ctx,
    );
    expect(result.outcome).toBe("applied");
    const client = result.client as Record<string, unknown>;
    expect(client.clientSecret).toMatch(/^twcs_/);
    const update = writeOps.find((w) => w.op === "update")!;
    const values = (update.args as { values: Record<string, unknown> }).values;
    expect(values.client_secret_hash).toMatch(/^scrypt\$/);
    expect(values.rotated_at).toBeInstanceOf(Date);
  });

  it("rejects rotating a revoked client", async () => {
    rowsQueue.push([clientRow({ status: "revoked" })]);
    const result = await rotateExternalCapabilityClient(
      {},
      { tenantId: TENANT_A, clientId: "twcap_abc" },
      ctx,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toBe("external_client_not_active");
  });
});

describe("revokeExternalCapabilityClient", () => {
  it("revokes an active client and never reveals a secret", async () => {
    rowsQueue.push([clientRow()]); // load
    rowsQueue.push([clientRow({ status: "revoked", revoked_at: new Date() })]);
    const result = await revokeExternalCapabilityClient(
      {},
      { tenantId: TENANT_A, clientId: "twcap_abc" },
      ctx,
    );
    expect(result.outcome).toBe("applied");
    const client = result.client as Record<string, unknown>;
    expect(client.status).toBe("revoked");
    expect(client.clientSecret).toBeNull();
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("is idempotent (second revoke = noop, no audit)", async () => {
    rowsQueue.push([clientRow({ status: "revoked", revoked_at: new Date() })]);
    const result = await revokeExternalCapabilityClient(
      {},
      { tenantId: TENANT_A, clientId: "twcap_abc" },
      ctx,
    );
    expect(result.outcome).toBe("noop");
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a client from another tenant", async () => {
    rowsQueue.push([clientRow({ tenant_id: TENANT_B })]);
    const result = await revokeExternalCapabilityClient(
      {},
      { tenantId: TENANT_A, clientId: "twcap_abc" },
      ctx,
    );
    expect(result.outcome).toBe("rejected");
    expect(result.reason).toBe("external_client_not_found");
  });
});

describe("externalCapabilityClients query", () => {
  it("lists clients without the secret or hash", async () => {
    rowsQueue.push([clientRow(), clientRow({ client_id: "twcap_zzz" })]);
    const rows = await externalCapabilityClients(
      {},
      { tenantId: TENANT_A },
      ctx,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.clientSecret).toBeNull();
      expect(row).not.toHaveProperty("client_secret_hash");
      expect(row).not.toHaveProperty("clientSecretHash");
    }
  });
});
