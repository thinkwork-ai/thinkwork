/**
 * capabilityCredentialBindings / tenantServicePrincipals resolver tests
 * (THINK-280 U2).
 *
 * Covers: operator gating, cross-tenant defense-in-depth filtering, the
 * redacted binding projection — and the structural guarantee that
 * `credential_refs_json` (vault references) NEVER appears anywhere in a
 * response.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { rowsQueue, whereArgs, mockRequireAdminOrServiceCaller } = vi.hoisted(
  () => ({
    rowsQueue: [] as unknown[][],
    whereArgs: [] as unknown[],
    mockRequireAdminOrServiceCaller: vi.fn(),
  }),
);

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
    select: () => ({
      from: () => ({
        where: (arg: unknown) => {
          whereArgs.push(arg);
          return selectChain();
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  },
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
  or: (...preds: unknown[]) => ({ op: "or", preds }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  inArray: (col: unknown, vals: unknown) => ({ op: "inArray", col, vals }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  capabilityDefinitionVersions: {
    definition_id: "capabilityDefinitionVersions.definition_id",
  },
  capabilityCredentialBindings: {
    tenant_id: "capabilityCredentialBindings.tenant_id",
    definition_version_id: "capabilityCredentialBindings.definition_version_id",
  },
  tenantServicePrincipals: {
    tenant_id: "tenantServicePrincipals.tenant_id",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: vi.fn(),
}));

vi.mock("../../../lib/compliance/emit.js", () => ({
  emitAuditEvent: vi.fn(),
}));

import {
  capabilityCredentialBindings,
  tenantServicePrincipals,
} from "./capabilityBindings.query.js";
import type { GraphQLContext } from "../../context.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "99999999-9999-9999-9999-999999999999";
const VERSION_ID = "33333333-3333-3333-3333-333333333333";
const SECRET_REF = "secretsmanager:thinkwork/dev/very-secret-ref";

const ctx = {} as GraphQLContext;

function bindingRow(overrides: Record<string, unknown>) {
  return {
    id: "bind-1",
    tenant_id: TENANT_A,
    definition_version_id: VERSION_ID,
    principal_mode: "service",
    service_principal_id: "sp-1",
    subject_user_id: null,
    credential_refs_json: { api_key: SECRET_REF },
    readiness: "ready",
    readiness_evidence_json: {
      probedAt: "2026-07-10T00:00:00.000Z",
      statusCode: 200,
    },
    last_verified_at: new Date("2026-07-10T00:00:00.000Z"),
    revoked_at: null,
    created_by_user_id: null,
    created_at: new Date("2026-07-09T00:00:00.000Z"),
    updated_at: new Date("2026-07-10T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  rowsQueue.length = 0;
  whereArgs.length = 0;
  vi.clearAllMocks();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
});

describe("authz", () => {
  it("rejects non-admin callers on both queries before any read", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(new Error("forbidden"));
    await expect(
      capabilityCredentialBindings(null, { tenantId: TENANT_A }, ctx),
    ).rejects.toThrow("forbidden");
    await expect(
      tenantServicePrincipals(null, { tenantId: TENANT_A }, ctx),
    ).rejects.toThrow("forbidden");
    expect(whereArgs).toHaveLength(0);
  });
});

describe("capabilityCredentialBindings", () => {
  it("maps bindings with redacted evidence and NEVER exposes credential refs", async () => {
    rowsQueue.push([bindingRow({})]);

    const result = await capabilityCredentialBindings(
      null,
      { tenantId: TENANT_A },
      ctx,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "bind-1",
      tenantId: TENANT_A,
      definitionVersionId: VERSION_ID,
      principalMode: "service",
      servicePrincipalId: "sp-1",
      readiness: "ready",
    });
    expect(JSON.parse(result[0]!.readinessEvidence as string)).toEqual({
      probedAt: "2026-07-10T00:00:00.000Z",
      statusCode: 200,
    });

    // The structural guarantee: no credential reference material anywhere.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("credential_refs");
    expect(serialized).not.toContain("credentialRefs");
    expect(serialized).not.toContain(SECRET_REF);
    expect(serialized).not.toContain("very-secret-ref");
  });

  it("filters forged cross-tenant rows and applies the version filter argument", async () => {
    rowsQueue.push([
      bindingRow({}),
      bindingRow({ id: "bind-forged", tenant_id: TENANT_B }),
    ]);

    const result = await capabilityCredentialBindings(
      null,
      { tenantId: TENANT_A, definitionVersionId: VERSION_ID },
      ctx,
    );
    expect(result.map((b) => b.id)).toEqual(["bind-1"]);
    // Both predicates ride the where clause when the filter is present.
    expect(whereArgs[0]).toMatchObject({
      op: "and",
      preds: [
        { op: "eq", val: TENANT_A },
        { op: "eq", val: VERSION_ID },
      ],
    });
  });
});

describe("tenantServicePrincipals", () => {
  it("maps principals and filters forged cross-tenant rows", async () => {
    rowsQueue.push([
      {
        id: "sp-1",
        tenant_id: TENANT_A,
        slug: "reporting-bot",
        display_name: "Reporting Bot",
        purpose: "Weekly digests",
        status: "active",
        created_at: new Date("2026-07-01T00:00:00.000Z"),
        revoked_at: null,
      },
      {
        id: "sp-forged",
        tenant_id: TENANT_B,
        slug: "intruder",
        display_name: "Intruder",
        purpose: null,
        status: "active",
        created_at: new Date("2026-07-01T00:00:00.000Z"),
        revoked_at: null,
      },
    ]);

    const result = await tenantServicePrincipals(
      null,
      { tenantId: TENANT_A },
      ctx,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "sp-1",
      tenantId: TENANT_A,
      slug: "reporting-bot",
      displayName: "Reporting Bot",
      purpose: "Weekly digests",
      status: "active",
    });
  });
});
