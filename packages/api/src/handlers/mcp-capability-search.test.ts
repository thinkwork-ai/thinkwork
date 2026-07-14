/**
 * mcp-capability-search — external MCP `search` facade (THINK-280 U8).
 *
 * Covers the happy path (permitted projection + exact compatibility identity),
 * AE9 (cross-tenant / execute / session / admission / proposal / credential
 * methods return nothing and expose no such tool), principal mapping fail-
 * closed, AE3 pinned-version, and the inert-when-disabled gate.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  operationContractHash,
  formatTwcapRef,
} from "@thinkwork/capability-contracts";
import { githubRestReferenceDescriptor } from "../lib/capabilities/platform-seeds/github-rest.js";

// ── Mocks ────────────────────────────────────────────────────────────────

const { rowsByTable, TABLES } = vi.hoisted(() => ({
  rowsByTable: new Map<string, unknown[]>(),
  TABLES: {
    capabilityDefinitions: "capabilityDefinitions",
    capabilityDefinitionVersions: "capabilityDefinitionVersions",
    capabilityCredentialBindings: "capabilityCredentialBindings",
    capabilityExternalClients: "capabilityExternalClients",
    tenantServicePrincipals: "tenantServicePrincipals",
    users: "users",
  } as const,
}));

function setRows(table: string, rows: unknown[]) {
  rowsByTable.set(table, rows);
}

vi.mock("@thinkwork/database-pg", () => {
  function builder(table: string) {
    const resolve = () => Promise.resolve(rowsByTable.get(table) ?? []);
    const chain = {
      where: () => chain,
      limit: () => resolve(),
      then: (...a: unknown[]) =>
        (resolve() as Promise<unknown>).then(...(a as [never])),
      catch: (...a: unknown[]) =>
        (resolve() as Promise<unknown>).catch(...(a as [never])),
    };
    return chain;
  }
  return {
    getDb: () => ({
      select: () => ({ from: (table: string) => builder(table) }),
    }),
  };
});

vi.mock("@thinkwork/database-pg/schema", () => TABLES);
vi.mock("drizzle-orm", () => ({
  and: (...preds: unknown[]) => ({ preds }),
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

vi.mock("./mcp-oauth.js", () => ({
  verifyMcpAccessToken: async (token: string) =>
    JSON.parse(Buffer.from(token, "base64url").toString("utf8")),
}));

import { handler } from "./mcp-capability-search.js";

// ── Fixture ───────────────────────────────────────────────────────────────

const host = "api.test";
const TENANT_A = "tenant-a";
const SP_ID = "sp-1";

const descriptor = githubRestReferenceDescriptor({
  namespace: "acme",
  owner: "acme",
  repo: "thinkwork",
});
const contractHashes: Record<string, string> = {};
for (const op of descriptor.operations) {
  contractHashes[op.operationId] = operationContractHash(op);
}

function expectedTwcap(operationId: string): string {
  return formatTwcapRef({
    namespace: "acme",
    class: "connection",
    slug: "github-rest",
    version: "1",
    operationId,
    contractHash: contractHashes[operationId]!,
  });
}

function seedTenantAAdmitted(
  opts: { readyBinding: boolean } = { readyBinding: true },
) {
  setRows(TABLES.capabilityDefinitions, [
    {
      id: "def-1",
      tenant_id: TENANT_A,
      namespace: "acme",
      class: "connection",
      slug: "github-rest",
      status: "active",
    },
  ]);
  setRows(TABLES.capabilityDefinitionVersions, [
    {
      id: "ver-1",
      definition_id: "def-1",
      version: 1,
      lifecycle: "admitted",
      descriptor_json: descriptor,
      contract_hashes_json: contractHashes,
    },
  ]);
  setRows(
    TABLES.capabilityCredentialBindings,
    opts.readyBinding
      ? [
          {
            id: "bind-1",
            tenant_id: TENANT_A,
            definition_version_id: "ver-1",
            principal_mode: "service",
            service_principal_id: SP_ID,
            subject_user_id: null,
            readiness: "ready",
          },
        ]
      : [],
  );
}

function m2mClaims(overrides: Record<string, unknown> = {}) {
  return {
    sub: "twcap-client-1",
    client_id: "twcap-client-1",
    service_principal_id: SP_ID,
    tenant_id: TENANT_A,
    scope: "capabilities:search",
    ...overrides,
  };
}

function bearer(claims: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(claims)).toString("base64url");
}

function rpcEvent(
  claims: Record<string, unknown> | null,
  body: unknown,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    rawPath: "/mcp/capabilities",
    headers: {
      host,
      "content-type": "application/json",
      ...(claims ? { authorization: `Bearer ${bearer(claims)}` } : {}),
    },
    requestContext: {
      domainName: host,
      http: { method: "POST", path: "/mcp/capabilities" },
    },
    isBase64Encoded: false,
    body: JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
}

function activeM2mRows() {
  setRows(TABLES.capabilityExternalClients, [
    {
      client_id: "twcap-client-1",
      status: "active",
      tenant_id: TENANT_A,
      service_principal_id: SP_ID,
    },
  ]);
  setRows(TABLES.tenantServicePrincipals, [
    { id: SP_ID, status: "active", tenant_id: TENANT_A },
  ]);
}

function call(event: APIGatewayProxyEventV2) {
  return handler(event).then((r) => JSON.parse(r.body || "{}"));
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("mcp-capability-search", () => {
  beforeEach(() => {
    rowsByTable.clear();
    process.env.CAPABILITY_EXTERNAL_SEARCH_ENABLED = "true";
    process.env.API_AUTH_SECRET = "test-secret";
  });

  it("exposes ONLY the read-only search tool", async () => {
    const body = await call(
      rpcEvent(m2mClaims(), { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    expect(body.result.tools).toHaveLength(1);
    expect(body.result.tools[0].name).toBe("search");
    // No execute/invoke/admit/propose/bind/session tool exists.
    const names = body.result.tools.map((t: { name: string }) => t.name);
    for (const forbidden of [
      "execute",
      "invoke",
      "admit",
      "propose",
      "bind_credential",
      "open_session",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("happy path: M2M token finds the admitted GitHub op with the exact twcap + contract hash", async () => {
    activeM2mRows();
    seedTenantAAdmitted();
    const body = await call(
      rpcEvent(m2mClaims(), {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "search", arguments: { query: "issues" } },
      }),
    );
    const ops = body.result.structuredContent.operations;
    const list = ops.find(
      (o: { operationId: string }) => o.operationId === "issues.list",
    );
    expect(list).toBeTruthy();
    expect(list.twcap).toBe(expectedTwcap("issues.list"));
    expect(list.contractHash).toBe(contractHashes["issues.list"]);
    expect(list.readiness).toBe("ready");
    expect(list.effect).toBe("read");
    // Redaction: no credential/provenance/other-principal fields leak.
    expect(list).not.toHaveProperty("credentialRefs");
    expect(list).not.toHaveProperty("provenance");
    expect(list).not.toHaveProperty("bindingId");
    expect(list).not.toHaveProperty("servicePrincipalId");
  });

  it("AE9: cross-tenant read returns nothing", async () => {
    activeM2mRows();
    // Only a tenant-B definition exists; the tenant-A principal sees nothing.
    setRows(TABLES.capabilityDefinitions, [
      {
        id: "def-b",
        tenant_id: "tenant-b",
        namespace: "other",
        class: "connection",
        slug: "github-rest",
        status: "active",
      },
    ]);
    const body = await call(
      rpcEvent(m2mClaims(), {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "search", arguments: {} },
      }),
    );
    expect(body.result.structuredContent.operations).toEqual([]);
  });

  it("AE9: execute/session/admit/propose/credential tool names are unknown", async () => {
    activeM2mRows();
    seedTenantAAdmitted();
    for (const name of [
      "execute",
      "open_session",
      "admit",
      "propose",
      "bind_credential",
    ]) {
      const body = await call(
        rpcEvent(m2mClaims(), {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name, arguments: {} },
        }),
      );
      expect(body.error.code).toBe(-32601);
      expect(body.error.message).toMatch(/Unknown tool/);
    }
  });

  it("fails closed when the mapped subject is revoked/unmapped", async () => {
    // Client row is revoked → principal maps to null → empty projection.
    setRows(TABLES.capabilityExternalClients, [
      {
        client_id: "twcap-client-1",
        status: "revoked",
        tenant_id: TENANT_A,
        service_principal_id: SP_ID,
      },
    ]);
    setRows(TABLES.tenantServicePrincipals, [
      { id: SP_ID, status: "active", tenant_id: TENANT_A },
    ]);
    seedTenantAAdmitted();
    const body = await call(
      rpcEvent(m2mClaims(), {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "search", arguments: {} },
      }),
    );
    expect(body.result.structuredContent.operations).toEqual([]);
  });

  it("rejects a token missing the capabilities:search scope", async () => {
    activeM2mRows();
    seedTenantAAdmitted();
    const body = await call(
      rpcEvent(m2mClaims({ scope: "memory:read" }), {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "search", arguments: {} },
      }),
    );
    expect(body.error.code).toBe(-32001);
  });

  it("is inert when external search is disabled", async () => {
    process.env.CAPABILITY_EXTERNAL_SEARCH_ENABLED = "false";
    activeM2mRows();
    seedTenantAAdmitted();
    const body = await call(
      rpcEvent(m2mClaims(), {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "search", arguments: {} },
      }),
    );
    expect(body.result.structuredContent.disabled).toBe(true);
    expect(body.result.structuredContent.operations).toEqual([]);
  });

  it("reports not_ready readiness when the principal has no ready binding", async () => {
    activeM2mRows();
    seedTenantAAdmitted({ readyBinding: false });
    const body = await call(
      rpcEvent(m2mClaims(), {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "search", arguments: { effect: "read" } },
      }),
    );
    const ops = body.result.structuredContent.operations;
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op.readiness).toBe("not_ready");
      expect(op.remediation).toMatch(/no ready binding/);
      // AE3: identity still exact even when not granted.
      expect(op.twcap).toBe(expectedTwcap(op.operationId));
    }
  });

  it("requires a bearer token", async () => {
    const response = await handler(
      rpcEvent(null, { jsonrpc: "2.0", id: 9, method: "tools/list" }),
    );
    expect(response.statusCode).toBe(401);
  });
});
