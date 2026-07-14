/**
 * DB-backed authorization loader (THINK-280 execution wiring).
 *
 * The loader is the broker's per-call re-authorization reload. These tests
 * confirm it composes a snapshot the pure policy (`authorizeAction`) ALLOWS for
 * a legitimate governed read, and fails closed (a snapshot the policy rejects)
 * on every drift/missing/degraded condition — the loader never returns an allow
 * itself; it returns facts the policy decides on.
 */

import { describe, expect, it } from "vitest";
import {
  formatTwcapRef,
  operationContractHash,
  parseTwcapRef,
  type CapabilityDescriptor,
  type OperationContract,
} from "@thinkwork/capability-contracts";
import { schema } from "@thinkwork/database-pg";
import { createDrizzleAuthorizationLoader } from "../lib/capability-broker/authorization-loader.js";
import { authorizeAction } from "../lib/capability-broker/policy.js";
import type { BrokerSessionState } from "../lib/capability-broker/sessions.js";

const {
  capabilityDefinitions,
  capabilityDefinitionVersions,
  capabilityCredentialBindings,
} = schema;

const TENANT = "00000000-0000-4000-8000-000000000001";
const DEF_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BINDING_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SP_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeOperation(
  overrides: Partial<OperationContract> = {},
): OperationContract {
  return {
    operationId: "issues.list",
    summary: "List open issues for the admitted repository",
    effect: "read",
    targetScope: {
      kind: "closed",
      resourceSelector: { repository: "acme/widgets" },
    },
    reversibility: "reversible",
    idempotency: "idempotent",
    principalModes: ["service"],
    approvalPolicy: "never",
    inputSchema: { type: "object", properties: { page: { type: "integer" } } },
    outputSchema: { type: "array" },
    inputDataClass: "internal",
    outputDataClass: "internal",
    costClass: "low",
    latencyClass: "interactive",
    outputClass: "inline",
    ...overrides,
  };
}

function makeDescriptor(op: OperationContract): CapabilityDescriptor {
  return {
    namespace: "acme",
    class: "connection",
    slug: "github-rest",
    version: "1",
    adapter: {
      kind: "http_openapi",
      config: { baseUrl: "https://api.github.com" },
    },
    bindingRequirements: {
      credentialKinds: ["bearer_token"],
      principalModes: ["service"],
    },
    provenance: {
      sourceUrls: ["https://docs.github.com/en/rest/issues/issues"],
      evidenceRefs: ["research:abc123"],
    },
    operations: [op],
  };
}

const OP = makeOperation();
const CONTRACT_HASH = operationContractHash(OP);
const CANONICAL_TWCAP = formatTwcapRef({
  namespace: "acme",
  class: "connection",
  slug: "github-rest",
  version: "1",
  operationId: "issues.list",
  contractHash: CONTRACT_HASH,
});

interface World {
  definitions?: Record<string, unknown>[];
  versions?: Record<string, unknown>[];
  bindings?: Record<string, unknown>[];
}

function fakeDb(world: World) {
  const rowsFor = (table: unknown): Record<string, unknown>[] => {
    if (table === capabilityDefinitions) return world.definitions ?? [];
    if (table === capabilityDefinitionVersions) return world.versions ?? [];
    if (table === capabilityCredentialBindings) return world.bindings ?? [];
    return [];
  };
  return {
    select: () => ({
      from: (table: unknown) => {
        const result = rowsFor(table);
        const chain = {
          where: () => chain,
          limit: (n: number) => Promise.resolve(result.slice(0, n)),
        };
        return chain;
      },
    }),
  } as never;
}

function definitionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DEF_ID,
    tenant_id: TENANT,
    namespace: "acme",
    class: "connection",
    slug: "github-rest",
    ...overrides,
  };
}

function versionRow(
  op: OperationContract = OP,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: VERSION_ID,
    definition_id: DEF_ID,
    version: 1,
    lifecycle: "admitted",
    descriptor_json: makeDescriptor(op),
    contract_hashes_json: { "issues.list": operationContractHash(op) },
    ...overrides,
  };
}

function bindingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BINDING_ID,
    definition_version_id: VERSION_ID,
    principal_mode: "service",
    service_principal_id: SP_ID,
    subject_user_id: null,
    readiness: "ready",
    credential_refs_json: { bearer_token: "vault://tok" },
    ...overrides,
  };
}

function serviceSession(
  overrides: Partial<BrokerSessionState> = {},
): BrokerSessionState {
  return {
    sessionId: "sess-1",
    tenantId: TENANT,
    audience: "broker-aud",
    publicKey: "",
    contextFingerprint: "ctx",
    principalMode: "service",
    subjectId: SP_ID,
    grantSnapshot: {},
    budgets: {},
    nextSequence: 0,
    cancelled: false,
    status: "active",
    brokerSessionRowId: "row-1",
    routineExecutionId: "exec-1",
    threadTurnId: null,
    createdEpochMs: 0,
    expiresEpochSeconds: 9_999_999_999,
    ...overrides,
  };
}

function loaderFor(world: World) {
  return createDrizzleAuthorizationLoader({
    db: fakeDb(world),
    schema: {
      capabilityDefinitions,
      capabilityDefinitionVersions,
      capabilityCredentialBindings,
    },
  });
}

async function load(world: World, session = serviceSession()) {
  const loader = loaderFor(world);
  return loader({
    session,
    operationRef: parseTwcapRef(CANONICAL_TWCAP),
    rawOperation: CANONICAL_TWCAP,
  });
}

function decide(snapshot: Awaited<ReturnType<typeof load>>) {
  return authorizeAction(
    {
      operation: snapshot.operation,
      currentContractHash: snapshot.currentContractHash,
      grant: snapshot.grant,
      binding: snapshot.binding
        ? {
            readiness: snapshot.binding.readiness,
            principalMode: snapshot.binding.principalMode,
            subjectId: snapshot.binding.subjectId,
          }
        : null,
      approval: snapshot.approval,
      budget: snapshot.budget,
    },
    {
      requestedContractHash: CONTRACT_HASH,
      principal: { mode: "service", subjectId: SP_ID },
    },
  );
}

describe("createDrizzleAuthorizationLoader", () => {
  it("authorizes a legitimate governed read end to end", async () => {
    const snapshot = await load({
      definitions: [definitionRow()],
      versions: [versionRow()],
      bindings: [bindingRow()],
    });
    expect(snapshot.definitionVersionId).toBe(VERSION_ID);
    expect(snapshot.adapterKind).toBe("http_openapi");
    expect(snapshot.currentContractHash).toBe(CONTRACT_HASH);
    expect(snapshot.grant).toEqual({ allowedEffects: ["read"] });
    expect(snapshot.binding?.readiness).toBe("ready");
    expect(snapshot.binding?.credentialRefs).toEqual({
      bearer_token: "vault://tok",
    });

    const decision = decide(snapshot);
    expect(decision.allowed).toBe(true);
  });

  it("fails closed when the definition is absent", async () => {
    const snapshot = await load({
      definitions: [],
      versions: [],
      bindings: [],
    });
    expect(snapshot.operation).toBeNull();
    expect(decide(snapshot).allowed).toBe(false);
  });

  it("fails closed when the version is not admitted", async () => {
    const snapshot = await load({
      definitions: [definitionRow()],
      versions: [versionRow(OP, { lifecycle: "candidate" })],
      bindings: [bindingRow()],
    });
    expect(snapshot.operation).toBeNull();
    expect(decide(snapshot).allowed).toBe(false);
  });

  it("fails closed on contract-hash drift (stored hash mismatched)", async () => {
    const snapshot = await load({
      definitions: [definitionRow()],
      versions: [
        versionRow(OP, {
          contract_hashes_json: { "issues.list": "sha256:stale" },
        }),
      ],
      bindings: [bindingRow()],
    });
    expect(snapshot.operation).toBeNull();
    expect(decide(snapshot).allowed).toBe(false);
  });

  it("blocks a degraded binding (readiness gate)", async () => {
    const snapshot = await load({
      definitions: [definitionRow()],
      versions: [versionRow()],
      bindings: [bindingRow({ readiness: "degraded" })],
    });
    expect(snapshot.binding?.readiness).toBe("degraded");
    const decision = decide(snapshot);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("binding_degraded");
  });

  it("blocks a revoked binding (AE8 revocation)", async () => {
    const snapshot = await load({
      definitions: [definitionRow()],
      versions: [versionRow()],
      bindings: [bindingRow({ readiness: "revoked" })],
    });
    const decision = decide(snapshot);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("binding_revoked");
  });

  it("blocks when no binding exists for the principal", async () => {
    const snapshot = await load({
      definitions: [definitionRow()],
      versions: [versionRow()],
      bindings: [],
    });
    expect(snapshot.binding).toBeNull();
    expect(decide(snapshot).allowed).toBe(false);
  });

  it("fails closed for a write operation whose approval is unsatisfiable in this slice", async () => {
    const writeOp = makeOperation({
      operationId: "issues.list",
      effect: "create",
      approvalPolicy: "always",
      reversibility: "reversible",
    });
    const writeHash = operationContractHash(writeOp);
    const writeTwcap = formatTwcapRef({
      namespace: "acme",
      class: "connection",
      slug: "github-rest",
      version: "1",
      operationId: "issues.list",
      contractHash: writeHash,
    });
    const loader = loaderFor({
      definitions: [definitionRow()],
      versions: [versionRow(writeOp)],
      bindings: [bindingRow()],
    });
    const snapshot = await loader({
      session: serviceSession(),
      operationRef: parseTwcapRef(writeTwcap),
      rawOperation: writeTwcap,
    });
    expect(snapshot.approval).toEqual({ policy: "always", satisfied: false });
    const decision = authorizeAction(
      {
        operation: snapshot.operation,
        currentContractHash: snapshot.currentContractHash,
        grant: snapshot.grant,
        binding: snapshot.binding
          ? {
              readiness: snapshot.binding.readiness,
              principalMode: snapshot.binding.principalMode,
              subjectId: snapshot.binding.subjectId,
            }
          : null,
        approval: snapshot.approval,
        budget: snapshot.budget,
      },
      {
        requestedContractHash: writeHash,
        principal: { mode: "service", subjectId: SP_ID },
      },
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("approval_required");
  });

  it("blocks when the session budget is marked exhausted", async () => {
    const snapshot = await load(
      {
        definitions: [definitionRow()],
        versions: [versionRow()],
        bindings: [bindingRow()],
      },
      serviceSession({ budgets: { exhausted: true } }),
    );
    expect(snapshot.budget.withinLimits).toBe(false);
    expect(decide(snapshot).allowed).toBe(false);
  });
});
