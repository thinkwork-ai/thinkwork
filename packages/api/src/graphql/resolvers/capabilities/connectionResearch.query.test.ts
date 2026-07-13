/**
 * connectionResearch resolver tests (THINK-280 U2).
 *
 * The research lib has its own suite; these tests cover the resolver
 * contract: operator gating before any read, argument pass-through, the
 * degraded external-discovery state detail, and the definition/proposal
 * projections (including the derived operations view and its fail-soft
 * malformed-descriptor behavior).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rowsQueue,
  mockRequireAdminOrServiceCaller,
  mockResolveCallerUserId,
  mockEmitAuditEvent,
  mockSearchCapabilityRuntime,
} = vi.hoisted(() => ({
  rowsQueue: [] as unknown[][],
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockEmitAuditEvent: vi.fn(),
  mockSearchCapabilityRuntime: vi.fn(),
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

function makeClient(label: string) {
  const client = {
    label,
    select: () => ({ from: () => ({ where: () => selectChain() }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(makeClient(`tx-of-${label}`)),
  };
  return client;
}

vi.mock("../../utils.js", () => ({
  db: makeClient("db"),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
  or: (...preds: unknown[]) => ({ op: "or", preds }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  inArray: (col: unknown, vals: unknown) => ({ op: "inArray", col, vals }),
  agents: {},
  tenants: {},
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
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
  emitAuditEvent: mockEmitAuditEvent,
}));

vi.mock("../../../lib/capabilities/research.js", () => ({
  searchCapabilityRuntime: mockSearchCapabilityRuntime,
}));

import {
  connectionResearch,
  EXTERNAL_DISCOVERY_DISABLED_DETAIL,
} from "./connectionResearch.query.js";
import type { GraphQLContext } from "../../context.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const DEF_ID = "22222222-2222-2222-2222-222222222222";
const VERSION_ID = "33333333-3333-3333-3333-333333333333";
const PROPOSAL_ID = "44444444-4444-4444-4444-444444444444";

const ctx = {} as GraphQLContext;

const CONTRACT_HASH = "a".repeat(64);

const OPERATION = {
  operationId: "list-repos",
  summary: "List repositories",
  effect: "read",
  targetScope: { kind: "open_world" },
  reversibility: "reversible",
  idempotency: "idempotent",
  principalModes: ["requester"],
  approvalPolicy: "never",
  inputSchema: {},
  outputSchema: {},
  inputDataClass: "internal",
  outputDataClass: "internal",
  costClass: "low",
  latencyClass: "interactive",
  outputClass: "inline",
};

const DESCRIPTOR = {
  namespace: "acme",
  class: "connection",
  slug: "github",
  version: "1",
  adapter: { kind: "http_openapi", config: {} },
  bindingRequirements: {
    credentialKinds: ["api_key"],
    principalModes: ["requester"],
  },
  provenance: { sourceUrls: ["https://docs.github.com"], evidenceRefs: [] },
  operations: [OPERATION],
};

const DEFINITION_ROW = {
  id: DEF_ID,
  tenant_id: TENANT_ID,
  namespace: "acme",
  class: "connection",
  slug: "github",
  display_name: "GitHub",
  status: "active",
  created_at: new Date("2026-07-01T00:00:00.000Z"),
};

const VERSION_ROW = {
  id: VERSION_ID,
  definition_id: DEF_ID,
  version: 1,
  lifecycle: "admitted",
  descriptor_json: DESCRIPTOR,
  descriptor_fingerprint: "b".repeat(64),
  contract_hashes_json: { "list-repos": CONTRACT_HASH },
  provenance_json: { sourceUrls: ["https://docs.github.com"] },
  source_proposal_id: PROPOSAL_ID,
  admitted_at: new Date("2026-07-02T00:00:00.000Z"),
  admitted_by_user_id: null,
  created_at: new Date("2026-07-02T00:00:00.000Z"),
};

const PROPOSAL_ROW = {
  id: PROPOSAL_ID,
  tenant_id: TENANT_ID,
  definition_id: null,
  payload_json: { descriptor: DESCRIPTOR },
  payload_fingerprint: "c".repeat(64),
  provenance_json: { sourceUrls: ["https://docs.github.com"] },
  status: "draft",
  inbox_item_id: null,
  created_by_actor_type: "user",
  created_by_actor_id: null,
  decided_at: null,
  decided_by_user_id: null,
  created_at: new Date("2026-07-03T00:00:00.000Z"),
};

beforeEach(() => {
  rowsQueue.length = 0;
  vi.clearAllMocks();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockResolveCallerUserId.mockResolvedValue(null);
  mockSearchCapabilityRuntime.mockResolvedValue({
    state: "ok",
    definitions: [],
    proposals: [],
  });
});

describe("authz", () => {
  it("rejects a non-admin caller before any research read", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(new Error("forbidden"));
    await expect(
      connectionResearch(null, { tenantId: TENANT_ID, query: "github" }, ctx),
    ).rejects.toThrow("forbidden");
    expect(mockSearchCapabilityRuntime).not.toHaveBeenCalled();
  });
});

describe("research projection", () => {
  it("passes args to the lib and maps definitions (with versions) + proposals", async () => {
    mockSearchCapabilityRuntime.mockResolvedValue({
      state: "ok",
      definitions: [DEFINITION_ROW],
      proposals: [PROPOSAL_ROW],
    });
    rowsQueue.push([VERSION_ROW]); // versions-by-definition load

    const result = await connectionResearch(
      null,
      { tenantId: TENANT_ID, query: "github" },
      ctx,
    );

    expect(mockSearchCapabilityRuntime).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: TENANT_ID,
        query: "github",
        allowExternal: false,
        externalFetcher: undefined,
      }),
    );
    expect(result.state).toBe("ok");
    expect(result.stateDetail).toBeNull();

    const [definition] = result.definitions as Array<Record<string, unknown>>;
    expect(definition).toMatchObject({
      id: DEF_ID,
      tenantId: TENANT_ID,
      namespace: "acme",
      class: "connection",
      slug: "github",
      displayName: "GitHub",
      status: "active",
    });
    const versions = definition.versions as Array<Record<string, unknown>>;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id: VERSION_ID,
      version: 1,
      lifecycle: "admitted",
      descriptorFingerprint: "b".repeat(64),
    });
    // AWSJSON fields travel as strings (snakeToCamel convention).
    expect(JSON.parse(versions[0]!.descriptor as string)).toEqual(DESCRIPTOR);
    expect(definition.admittedVersion).toMatchObject({ id: VERSION_ID });

    const operations = versions[0]!.operations as Array<
      Record<string, unknown>
    >;
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      operationId: "list-repos",
      contractHash: CONTRACT_HASH,
      effect: "read",
      principalModes: ["requester"],
      approvalPolicy: "never",
      executable: true,
      withheldReasons: [],
    });
    expect(operations[0]!.twcap).toBe(
      `twcap://acme/connection/github/versions/1/operations/list-repos?contract=sha256:${CONTRACT_HASH}`,
    );

    const [proposal] = result.proposals as Array<Record<string, unknown>>;
    expect(proposal).toMatchObject({
      id: PROPOSAL_ID,
      tenantId: TENANT_ID,
      payloadFingerprint: "c".repeat(64),
      status: "draft",
    });
  });

  it("unknown-class operations are non-executable with the validator's verbatim reasons", async () => {
    const withheldOp = { ...OPERATION, costClass: "unknown" };
    mockSearchCapabilityRuntime.mockResolvedValue({
      state: "ok",
      definitions: [DEFINITION_ROW],
      proposals: [],
    });
    rowsQueue.push([
      {
        ...VERSION_ROW,
        descriptor_json: { ...DESCRIPTOR, operations: [withheldOp] },
      },
    ]);

    const result = await connectionResearch(
      null,
      { tenantId: TENANT_ID, query: "github" },
      ctx,
    );
    const [definition] = result.definitions as Array<Record<string, unknown>>;
    const [version] = definition.versions as Array<Record<string, unknown>>;
    const [operation] = version.operations as Array<Record<string, unknown>>;
    expect(operation).toMatchObject({
      executable: false,
      withheldReasons: ["costClass is unknown"],
    });
  });

  it("a malformed stored descriptor renders operations: [] without failing the query", async () => {
    mockSearchCapabilityRuntime.mockResolvedValue({
      state: "ok",
      definitions: [DEFINITION_ROW],
      proposals: [],
    });
    rowsQueue.push([
      { ...VERSION_ROW, descriptor_json: { operations: "not-an-array" } },
    ]);

    const result = await connectionResearch(
      null,
      { tenantId: TENANT_ID, query: "github" },
      ctx,
    );
    const [definition] = result.definitions as Array<Record<string, unknown>>;
    const [version] = definition.versions as Array<Record<string, unknown>>;
    expect(version.operations).toEqual([]);
    // The version itself still renders — the skip is stateless.
    expect(version).toMatchObject({ id: VERSION_ID, lifecycle: "admitted" });
  });
});

describe("external discovery seam", () => {
  it("allowExternal=true degrades with the fixed 'not yet enabled' detail", async () => {
    mockSearchCapabilityRuntime.mockResolvedValue({
      state: "degraded",
      stateDetail:
        "external discovery requested but no fetcher is configured in this slice",
      definitions: [],
      proposals: [],
    });

    const result = await connectionResearch(
      null,
      { tenantId: TENANT_ID, query: "github", allowExternal: true },
      ctx,
    );
    expect(mockSearchCapabilityRuntime).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowExternal: true }),
    );
    expect(result.state).toBe("degraded");
    expect(result.stateDetail).toBe(EXTERNAL_DISCOVERY_DISABLED_DETAIL);
  });
});
