/**
 * capabilityRuntimeCatalog resolver tests (THINK-280 U2).
 *
 * Covers: operator gating, tenant + platform visibility with a
 * defense-in-depth cross-tenant filter, versions[] / admittedVersion
 * selection, and the fail-soft malformed-descriptor operations skip.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { rowsQueue, mockRequireAdminOrServiceCaller, mockResolveCallerUserId } =
  vi.hoisted(() => ({
    rowsQueue: [] as unknown[][],
    mockRequireAdminOrServiceCaller: vi.fn(),
    mockResolveCallerUserId: vi.fn(),
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
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  },
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
  or: (...preds: unknown[]) => ({ op: "or", preds }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  inArray: (col: unknown, vals: unknown) => ({ op: "inArray", col, vals }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  capabilityDefinitions: {
    tenant_id: "capabilityDefinitions.tenant_id",
  },
  capabilityDefinitionVersions: {
    definition_id: "capabilityDefinitionVersions.definition_id",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../../lib/compliance/emit.js", () => ({
  emitAuditEvent: vi.fn(),
}));

import { capabilityRuntimeCatalog } from "./capabilityRuntimeCatalog.query.js";
import type { GraphQLContext } from "../../context.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "99999999-9999-9999-9999-999999999999";

const ctx = {} as GraphQLContext;

const CONTRACT_HASH = "d".repeat(64);

const OPERATION = {
  operationId: "send",
  summary: "Send",
  effect: "create",
  targetScope: { kind: "open_world" },
  reversibility: "reversible",
  idempotency: "non_idempotent",
  principalModes: ["service"],
  approvalPolicy: "once",
  inputSchema: {},
  outputSchema: {},
  inputDataClass: "internal",
  outputDataClass: "internal",
  costClass: "low",
  latencyClass: "interactive",
  outputClass: "inline",
};

function definitionRow(overrides: Record<string, unknown>) {
  return {
    id: "def-1",
    tenant_id: TENANT_A,
    namespace: "acme",
    class: "connection",
    slug: "slack",
    display_name: "Slack",
    status: "active",
    created_at: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

function versionRow(overrides: Record<string, unknown>) {
  return {
    id: "ver-1",
    definition_id: "def-1",
    version: 1,
    lifecycle: "admitted",
    descriptor_json: {
      namespace: "acme",
      class: "connection",
      slug: "slack",
      version: "1",
      adapter: { kind: "http_openapi", config: {} },
      bindingRequirements: {
        credentialKinds: ["bearer_token"],
        principalModes: ["service"],
      },
      provenance: { sourceUrls: ["https://api.slack.com"], evidenceRefs: [] },
      operations: [OPERATION],
    },
    descriptor_fingerprint: "e".repeat(64),
    contract_hashes_json: { send: CONTRACT_HASH },
    provenance_json: {},
    source_proposal_id: null,
    admitted_at: new Date("2026-07-02T00:00:00.000Z"),
    admitted_by_user_id: null,
    created_at: new Date("2026-07-02T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  rowsQueue.length = 0;
  vi.clearAllMocks();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
});

describe("authz", () => {
  it("rejects a non-admin caller before any read", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(new Error("forbidden"));
    await expect(
      capabilityRuntimeCatalog(null, { tenantId: TENANT_A }, ctx),
    ).rejects.toThrow("forbidden");
    expect(rowsQueue).toHaveLength(0);
  });
});

describe("catalog projection", () => {
  it("returns tenant + platform definitions and filters forged cross-tenant rows", async () => {
    rowsQueue.push([
      definitionRow({}),
      definitionRow({
        id: "def-platform",
        tenant_id: null,
        namespace: "vendor",
        slug: "reference",
        display_name: "Reference",
      }),
      // Defense-in-depth: a tenant-B row sneaking through the SQL predicate
      // never reaches the response.
      definitionRow({ id: "def-forged", tenant_id: TENANT_B, slug: "forged" }),
    ]);
    rowsQueue.push([versionRow({})]); // versions load

    const result = await capabilityRuntimeCatalog(
      null,
      { tenantId: TENANT_A },
      ctx,
    );

    const ids = result.map((d) => d.id);
    expect(ids).toContain("def-1");
    expect(ids).toContain("def-platform");
    expect(ids).not.toContain("def-forged");

    const tenantDef = result.find((d) => d.id === "def-1")!;
    expect(tenantDef.admittedVersion).toMatchObject({
      id: "ver-1",
      lifecycle: "admitted",
    });
    const versions = tenantDef.versions as Array<Record<string, unknown>>;
    const operations = versions[0]!.operations as Array<
      Record<string, unknown>
    >;
    expect(operations[0]).toMatchObject({
      operationId: "send",
      twcap: `twcap://acme/connection/slack/versions/1/operations/send?contract=sha256:${CONTRACT_HASH}`,
      executable: true,
    });

    const platformDef = result.find((d) => d.id === "def-platform")!;
    expect(platformDef.tenantId).toBeNull();
    expect(platformDef.versions).toEqual([]);
    expect(platformDef.admittedVersion).toBeNull();
  });

  it("admittedVersion is the latest admitted version; candidates render but never win", async () => {
    rowsQueue.push([definitionRow({})]);
    rowsQueue.push([
      versionRow({ id: "ver-1", version: 1 }),
      versionRow({ id: "ver-2", version: 2 }),
      versionRow({ id: "ver-3", version: 3, lifecycle: "candidate" }),
    ]);

    const [definition] = await capabilityRuntimeCatalog(
      null,
      { tenantId: TENANT_A },
      ctx,
    );
    expect(definition!.admittedVersion).toMatchObject({
      id: "ver-2",
      version: 2,
    });
    expect(
      (definition!.versions as Array<Record<string, unknown>>).map((v) => v.id),
    ).toEqual(["ver-1", "ver-2", "ver-3"]);
  });

  it("a version whose contract hash is missing renders operations: [] without failing the query", async () => {
    rowsQueue.push([definitionRow({})]);
    rowsQueue.push([versionRow({ contract_hashes_json: {} })]);

    const [definition] = await capabilityRuntimeCatalog(
      null,
      { tenantId: TENANT_A },
      ctx,
    );
    const versions = definition!.versions as Array<Record<string, unknown>>;
    expect(versions[0]!.operations).toEqual([]);
    expect(versions[0]).toMatchObject({ id: "ver-1" });
  });
});
