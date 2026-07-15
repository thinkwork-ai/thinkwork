/**
 * capability-control-service handler tests (THINK-280 U2).
 *
 * Covers the trust boundary (signed capability caller context — absent,
 * forged, wrong-kind, expired all reject fail-closed), the closed action
 * union, the exact-tuple working search (admitted-only, executable-only,
 * exact-principal binding with no cross-mode fallback — AE2), and the
 * research action (search + draft proposal evidence; F1: research output
 * can never resolve in capability_search because search reads only
 * admitted version rows).
 */

import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  isDescriptorShapedRejection,
  handleCapabilityControl,
  type CapabilityControlEvent,
} from "./capability-control-service.js";
import { capabilitySignerFromKey } from "../lib/capabilities/sidecar-signing.js";
import { mintCapabilityCallerContext } from "../lib/capabilities/caller-context.js";
import {
  ANALYST_CALLER_CONTEXT_KIND,
  encodeAnalystCallerContextHeader,
  type AnalystCallerContextPayload,
} from "@thinkwork/lambda/analyst-caller-context";

// ---------------------------------------------------------------------------
// Keys + contexts
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const signer = capabilitySignerFromKey(privateKey);

const { privateKey: otherPrivateKey } = generateKeyPairSync("ed25519");
const otherSigner = capabilitySignerFromKey(otherPrivateKey);

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "33333333-3333-3333-3333-333333333333";

async function mintContext(
  overrides: Partial<Parameters<typeof mintCapabilityCallerContext>[0]> = {},
): Promise<string> {
  const value = await mintCapabilityCallerContext({
    actor: "agent",
    tenantId: TENANT_ID,
    agentId: AGENT_ID,
    actorUserId: USER_ID,
    signer,
    ...overrides,
  });
  if (!value) throw new Error("mint returned null");
  return value;
}

// ---------------------------------------------------------------------------
// Mock db — queued select rows + recorded inserts
// ---------------------------------------------------------------------------

interface MockDb {
  db: never;
  selectQueue: unknown[][];
  inserted: Array<Record<string, unknown>>;
}

function mockDb(): MockDb {
  const selectQueue: unknown[][] = [];
  const inserted: Array<Record<string, unknown>> = [];
  const chain = () => {
    const rows = Promise.resolve(selectQueue.shift() ?? []);
    const chained: Record<string, unknown> = {
      limit: () => rows,
      then: rows.then.bind(rows),
      catch: rows.catch.bind(rows),
    };
    return chained;
  };
  const db = {
    select: () => ({ from: () => ({ where: () => chain() }) }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          const row = {
            id: `proposal-${inserted.length + 1}`,
            created_at: new Date("2026-07-13T00:00:00Z"),
            ...values,
          };
          inserted.push(row);
          return [row];
        },
      }),
    }),
  } as never;
  return { db, selectQueue, inserted };
}

// ---------------------------------------------------------------------------
// Fixture rows
// ---------------------------------------------------------------------------

const OPERATION = {
  operationId: "repos.get",
  summary: "Get a repository",
  effect: "read",
  targetScope: { kind: "open_world" as const },
  reversibility: "reversible",
  idempotency: "idempotent",
  principalModes: ["requester", "service"],
  approvalPolicy: "never",
  inputSchema: {},
  outputSchema: {},
  inputDataClass: "internal",
  outputDataClass: "internal",
  costClass: "low",
  latencyClass: "interactive",
  outputClass: "inline",
};

const CONTRACT_HASH = "a".repeat(64);

const definitionRow = {
  id: "def-1",
  tenant_id: TENANT_ID,
  namespace: "acme",
  class: "connection",
  slug: "github-rest",
  display_name: "GitHub REST",
  status: "active",
  created_at: new Date(),
};

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ver-1",
    definition_id: "def-1",
    version: 1,
    lifecycle: "admitted",
    descriptor_json: {
      namespace: "acme",
      class: "connection",
      slug: "github-rest",
      version: "1",
      operations: [OPERATION],
    },
    contract_hashes_json: { "repos.get": CONTRACT_HASH },
    ...overrides,
  };
}

function bindingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bind-1",
    tenant_id: TENANT_ID,
    definition_version_id: "ver-1",
    principal_mode: "service",
    service_principal_id: "sp-1",
    subject_user_id: null,
    readiness: "ready",
    ...overrides,
  };
}

function searchEvent(callerContext: string): CapabilityControlEvent {
  return {
    action: "capability_search",
    callerContext,
    tuple: {
      namespace: "acme",
      class: "connection",
      slug: "github-rest",
      operationId: "repos.get",
    },
    principalMode: "service",
  };
}

// ---------------------------------------------------------------------------
// Trust boundary
// ---------------------------------------------------------------------------

describe("caller-context trust boundary", () => {
  it("rejects an absent caller context fail-closed", async () => {
    const { db } = mockDb();
    const result = await handleCapabilityControl(
      { action: "capability_search" },
      { db, publicKeyPem },
    );
    expect(result).toEqual({ ok: false, reason: "invalid_caller_context" });
  });

  it("rejects a context signed by a different key (forged)", async () => {
    const { db } = mockDb();
    const forged = await mintCapabilityCallerContext({
      actor: "agent",
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      signer: otherSigner,
    });
    const result = await handleCapabilityControl(searchEvent(forged!), {
      db,
      publicKeyPem,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_caller_context" });
  });

  it("rejects an ANALYST caller context under the same key (kind domain separation)", async () => {
    const { db } = mockDb();
    const payload: AnalystCallerContextPayload = {
      kind: ANALYST_CALLER_CONTEXT_KIND,
      tenantId: TENANT_ID,
      actor: "agent",
      policyClaims: {},
      iat: Date.now(),
      exp: Date.now() + 60_000,
    };
    const signature = signer.signPayload(
      payload as unknown as Record<string, unknown>,
      { signedBy: "api-dispatch" },
    );
    const analystHeader = encodeAnalystCallerContextHeader({
      payload,
      signature,
    });
    const result = await handleCapabilityControl(searchEvent(analystHeader), {
      db,
      publicKeyPem,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_caller_context" });
  });

  it("rejects an expired context", async () => {
    const { db } = mockDb();
    const expired = await mintContext({ nowMs: Date.now() - 60 * 60 * 1000 });
    const result = await handleCapabilityControl(searchEvent(expired), {
      db,
      publicKeyPem,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_caller_context" });
  });

  it("rejects when the public key is unavailable (fail closed, not open)", async () => {
    const { db } = mockDb();
    const context = await mintContext();
    const result = await handleCapabilityControl(searchEvent(context), {
      db,
      publicKeyPem: null,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_caller_context" });
  });

  it("rejects unknown actions before touching identity or the db", async () => {
    const { db } = mockDb();
    const result = await handleCapabilityControl(
      { action: "bind_credentials", callerContext: await mintContext() },
      { db, publicKeyPem },
    );
    expect(result).toEqual({ ok: false, reason: "unknown_action" });
  });
});

// ---------------------------------------------------------------------------
// capability_search
// ---------------------------------------------------------------------------

describe("capability_search", () => {
  it("resolves an admitted executable operation with a ready exact-principal binding", async () => {
    const { db, selectQueue } = mockDb();
    selectQueue.push([definitionRow], [versionRow()], [bindingRow()]);

    const result = await handleCapabilityControl(
      searchEvent(await mintContext()),
      { db, publicKeyPem },
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.action !== "capability_search") throw new Error();
    expect(result.result).toMatchObject({
      found: true,
      operationId: "repos.get",
      contractHash: CONTRACT_HASH,
      principalMode: "service",
      bindingId: "bind-1",
      version: 1,
      twcap:
        `twcap://acme/connection/github-rest/versions/1/operations/repos.get` +
        `?contract=sha256:${CONTRACT_HASH}`,
    });
  });

  it("derives the tenant from the VERIFIED context — a foreign tenant's definition never resolves", async () => {
    const { db, selectQueue } = mockDb();
    selectQueue.push([{ ...definitionRow, tenant_id: "other-tenant" }]);
    const result = await handleCapabilityControl(
      searchEvent(await mintContext()),
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "capability_search") throw new Error();
    expect(result.result).toEqual({
      found: false,
      reason: "definition_not_found",
    });
  });

  it("never resolves candidate (unadmitted) versions — research output stays non-executable (F1)", async () => {
    const { db, selectQueue } = mockDb();
    selectQueue.push([definitionRow], [versionRow({ lifecycle: "candidate" })]);
    const result = await handleCapabilityControl(
      searchEvent(await mintContext()),
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "capability_search") throw new Error();
    expect(result.result).toEqual({
      found: false,
      reason: "no_admitted_version",
    });
  });

  it("withholds operations that fail the shared executability validator", async () => {
    const { db, selectQueue } = mockDb();
    selectQueue.push(
      [definitionRow],
      [
        versionRow({
          descriptor_json: {
            namespace: "acme",
            class: "connection",
            slug: "github-rest",
            version: "1",
            operations: [{ ...OPERATION, costClass: "unknown" }],
          },
        }),
      ],
    );
    const result = await handleCapabilityControl(
      searchEvent(await mintContext()),
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "capability_search") throw new Error();
    expect(result.result).toMatchObject({
      found: false,
      reason: "operation_withheld",
      withheldReasons: ["costClass is unknown"],
    });
  });

  it("does NOT fall back across principal modes when only another mode is ready (AE2)", async () => {
    const { db, selectQueue } = mockDb();
    selectQueue.push(
      [definitionRow],
      [versionRow()],
      // Only a requester binding is ready; the request asks for service.
      [
        bindingRow({
          id: "bind-req",
          principal_mode: "requester",
          service_principal_id: null,
        }),
      ],
    );
    const result = await handleCapabilityControl(
      searchEvent(await mintContext()),
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "capability_search") throw new Error();
    expect(result.result).toEqual({
      found: false,
      reason: "no_ready_binding_for_principal",
    });
  });

  it("ignores non-ready bindings (degraded/revoked/pending)", async () => {
    const { db, selectQueue } = mockDb();
    selectQueue.push(
      [definitionRow],
      [versionRow()],
      [bindingRow({ readiness: "degraded" })],
    );
    const result = await handleCapabilityControl(
      searchEvent(await mintContext()),
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "capability_search") throw new Error();
    expect(result.result).toEqual({
      found: false,
      reason: "no_ready_binding_for_principal",
    });
  });

  it("only satisfies a user-pinned binding for the verified acting user", async () => {
    const { db, selectQueue } = mockDb();
    selectQueue.push(
      [definitionRow],
      [versionRow()],
      [
        bindingRow({
          principal_mode: "requester",
          service_principal_id: null,
          subject_user_id: "someone-else",
        }),
      ],
    );
    const result = await handleCapabilityControl(
      {
        ...searchEvent(await mintContext()),
        principalMode: "requester",
      },
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "capability_search") throw new Error();
    expect(result.result).toEqual({
      found: false,
      reason: "no_ready_binding_for_principal",
    });
  });

  it("rejects a malformed tuple with a typed reason", async () => {
    const { db } = mockDb();
    const result = await handleCapabilityControl(
      {
        action: "capability_search",
        callerContext: await mintContext(),
        tuple: { namespace: "acme" },
        principalMode: "service",
      },
      { db, publicKeyPem },
    );
    expect(result).toMatchObject({ ok: false, reason: "invalid_tuple" });
  });
});

// ---------------------------------------------------------------------------
// connection_research
// ---------------------------------------------------------------------------

describe("connection_research", () => {
  it("returns definition + proposal summaries for the verified tenant", async () => {
    const { db, selectQueue } = mockDb();
    selectQueue.push(
      [definitionRow],
      [
        {
          id: "prop-1",
          tenant_id: TENANT_ID,
          definition_id: null,
          payload_json: { slug: "github-rest" },
          payload_fingerprint: "f".repeat(64),
          status: "draft",
          created_at: new Date("2026-07-10T00:00:00Z"),
        },
      ],
    );
    const result = await handleCapabilityControl(
      {
        action: "connection_research",
        callerContext: await mintContext(),
        query: "github",
      },
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "connection_research")
      throw new Error();
    expect(result.result.state).toBe("ok");
    // Authoring reference always rides research results — the composing
    // agent has no other way to learn the descriptor enum vocabulary.
    expect(result.result.descriptorContract?.enums["adapter.kind"]).toContain(
      "http_openapi",
    );
    expect(
      result.result.descriptorContract?.example.operations[0]?.latencyClass,
    ).toBe("interactive");
    expect(result.result.definitions).toEqual([
      {
        id: "def-1",
        namespace: "acme",
        class: "connection",
        slug: "github-rest",
        displayName: "GitHub REST",
        status: "active",
        tenantScoped: true,
      },
    ]);
    expect(result.result.proposals).toMatchObject([
      { id: "prop-1", status: "draft" },
    ]);
  });

  it("degrades (never fails) when external discovery is requested without a fetcher", async () => {
    const { db, selectQueue } = mockDb();
    selectQueue.push([], []);
    const result = await handleCapabilityControl(
      {
        action: "connection_research",
        callerContext: await mintContext(),
        query: "github",
        allowExternal: true,
      },
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "connection_research")
      throw new Error();
    expect(result.result.state).toBe("degraded");
    expect(result.result.definitions).toEqual([]);
  });

  it("creates a draft proposal stamped with the VERIFIED agent identity", async () => {
    const { db, selectQueue, inserted } = mockDb();
    selectQueue.push([], []);
    const result = await handleCapabilityControl(
      {
        action: "connection_research",
        callerContext: await mintContext(),
        query: "github",
        proposal: {
          payload: { descriptor: { slug: "github-rest" } },
          sourceUrls: ["https://docs.github.com/rest"],
        },
      },
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "connection_research")
      throw new Error();
    expect(result.result.createdProposal).toMatchObject({
      outcome: "applied",
      proposalId: "proposal-1",
    });
    // Loop nudge: names the admit tool and carries the created proposal id.
    expect(result.result.createdProposal?.nextStep).toContain(
      "self_admit_capability",
    );
    expect(result.result.createdProposal?.nextStep).toContain("proposal-1");
    expect(inserted[0]).toMatchObject({
      tenant_id: TENANT_ID,
      status: "draft",
      created_by_actor_type: "agent",
      created_by_actor_id: AGENT_ID,
    });
  });

  it("rejects a proposal without official https source URLs", async () => {
    const { db, selectQueue, inserted } = mockDb();
    selectQueue.push([], []);
    const result = await handleCapabilityControl(
      {
        action: "connection_research",
        callerContext: await mintContext(),
        query: "github",
        proposal: {
          payload: { descriptor: { slug: "github-rest" } },
          sourceUrls: ["http://insecure.example.com"],
        },
      },
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "connection_research")
      throw new Error();
    expect(result.result.createdProposal?.outcome).toBe("rejected");
    expect(inserted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// routine_propose (THINK-280 U6) — create-only; never approve/commit/validate
// ---------------------------------------------------------------------------

function routineBundle(overrides: Record<string, unknown> = {}) {
  return {
    slug: "issue-health",
    code: "def run(input):\n    return {'ok': True}\n",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    fixtures: [
      { path: "fixtures/00.json", input: { n: 1 }, expected: { ok: true } },
    ],
    invariants: [],
    dependencies: [
      {
        twcap: "twcap://acme/connection/github-rest@1/repos.get",
        contractHash: CONTRACT_HASH,
        definitionVersionId: "ver-1",
      },
    ],
    minimumGrants: null,
    principal: { mode: "service" },
    effectSummary: { effect: "read" },
    evidence: { brokerSessionId: "bs-1" },
    ...overrides,
  };
}

describe("routine_propose", () => {
  it("creates a submitted proposal, deriving tenant + actor from the verified context", async () => {
    const { db, selectQueue, inserted } = mockDb();
    // deps validation reads admitted versions, then the supersede scan.
    selectQueue.push([versionRow()], []);
    const result = await handleCapabilityControl(
      {
        action: "routine_propose",
        callerContext: await mintContext(),
        // Plaintext CANNOT assert another tenant/user — ignored by the handler.
        routineProposal: { bundle: routineBundle() },
      },
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "routine_propose")
      throw new Error("expected routine_propose ok");
    expect(result.result.outcome).toBe("applied");
    expect(result.result.status).toBe("submitted");
    expect(result.result.payloadFingerprint).toMatch(/^[a-f0-9]{64}$/);
    // Loop nudge: the model reads this verbatim — it must name the promote
    // tool and carry the created proposal id.
    expect(result.result.nextStep).toContain("self_promote_routine");
    expect(result.result.nextStep).toContain(result.result.proposalId);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].tenant_id).toBe(TENANT_ID);
    expect(inserted[0].created_by_actor_type).toBe("agent");
    expect(inserted[0].created_by_actor_id).toBe(AGENT_ID);
    // Create-only: status is never beyond 'submitted'; no commit sha.
    expect(inserted[0].promoted_commit_sha ?? null).toBeNull();
  });

  it("rejects a dependency absent from the tenant's admitted versions (forged manifest)", async () => {
    const { db, selectQueue, inserted } = mockDb();
    selectQueue.push([], []); // no admitted version for the claimed dependency
    const result = await handleCapabilityControl(
      {
        action: "routine_propose",
        callerContext: await mintContext(),
        routineProposal: { bundle: routineBundle() },
      },
      { db, publicKeyPem },
    );
    if (!result.ok || result.action !== "routine_propose") throw new Error();
    expect(result.result.outcome).toBe("rejected");
    expect(result.result.reason).toContain("dependency_not_admitted");
    expect(inserted).toHaveLength(0);
  });

  it("has no approve/commit/validate/activate action — the service cannot promote", async () => {
    const { db } = mockDb();
    for (const action of [
      "approve_routine",
      "commit_routine",
      "promote_routine",
      "activate_routine",
    ]) {
      const result = await handleCapabilityControl(
        { action, callerContext: await mintContext() } as never,
        { db, publicKeyPem },
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error();
      expect(result.reason).toBe("unknown_action");
    }
  });

  it("rejects routine_propose with a forged (wrong-key) caller context, fail-closed", async () => {
    const { db, inserted } = mockDb();
    const forged = await mintCapabilityCallerContext({
      actor: "agent",
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      signer: otherSigner,
    });
    const result = await handleCapabilityControl(
      {
        action: "routine_propose",
        callerContext: forged!,
        routineProposal: { bundle: routineBundle() },
      },
      { db, publicKeyPem },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("invalid_caller_context");
    expect(inserted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Governed autonomy (U4) — self_admit_connection / self_approve_routine gate
// ---------------------------------------------------------------------------

describe("self-extension actions (governed autonomy)", () => {
  const SELF_EXT_KEY = "CAPABILITY_SELF_EXTENSION_TENANTS";

  function withSelfExtension<T>(value: string | null, fn: () => T): T {
    const prev = process.env[SELF_EXT_KEY];
    if (value === null) delete process.env[SELF_EXT_KEY];
    else process.env[SELF_EXT_KEY] = value;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env[SELF_EXT_KEY];
      else process.env[SELF_EXT_KEY] = prev;
    }
  }

  it("recognizes both actions (not unknown_action)", async () => {
    // Gate OFF by default — the actions exist but reject fail-closed, which is
    // a different reason than an unknown action.
    const { db } = mockDb();
    const admit = await withSelfExtension(null, () =>
      handleCapabilityControl(
        {
          action: "self_admit_connection",
          callerContext: "",
          proposalId: "p-1",
        },
        { db, publicKeyPem },
      ),
    );
    // Empty caller context rejects at the trust boundary before the gate, but
    // the action itself was accepted into the union (no unknown_action).
    expect(admit.ok).toBe(false);
    if (admit.ok) throw new Error();
    expect(admit.reason).not.toBe("unknown_action");
  });

  it("is fail-closed by default: self_admit_connection rejects self_extension_disabled", async () => {
    const { db } = mockDb();
    const context = await mintContext();
    const result = await withSelfExtension(null, () =>
      handleCapabilityControl(
        {
          action: "self_admit_connection",
          callerContext: context,
          proposalId: "p-1",
        },
        { db, publicKeyPem },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("self_extension_disabled");
  });

  it("is fail-closed by default: self_approve_routine rejects self_extension_disabled", async () => {
    const { db } = mockDb();
    const context = await mintContext();
    const result = await withSelfExtension(null, () =>
      handleCapabilityControl(
        {
          action: "self_approve_routine",
          callerContext: context,
          proposalId: "p-1",
        },
        { db, publicKeyPem },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("self_extension_disabled");
  });

  it("does not enable a tenant absent from the allowlist", async () => {
    const { db } = mockDb();
    const context = await mintContext();
    const result = await withSelfExtension(
      "99999999-9999-9999-9999-999999999999",
      () =>
        handleCapabilityControl(
          {
            action: "self_admit_connection",
            callerContext: context,
            proposalId: "p-1",
          },
          { db, publicKeyPem },
        ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("self_extension_disabled");
  });

  it("enabled but missing proposalId rejects invalid_proposal_id (before touching the lib)", async () => {
    const { db } = mockDb();
    const context = await mintContext();
    const result = await withSelfExtension(TENANT_ID, () =>
      handleCapabilityControl(
        { action: "self_admit_connection", callerContext: context },
        { db, publicKeyPem },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("invalid_proposal_id");
  });

  it("self_approve_routine enabled but missing proposalId rejects invalid_proposal_id", async () => {
    const { db } = mockDb();
    const context = await mintContext();
    const result = await withSelfExtension(TENANT_ID, () =>
      handleCapabilityControl(
        { action: "self_approve_routine", callerContext: context },
        { db, publicKeyPem },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("invalid_proposal_id");
  });

  it("requires the agent's capability_folder_dispatch flag (U6): an agent without it is rejected", async () => {
    // Tenant opted in + a valid proposalId, but the agent lookup returns no
    // row with the flag → folder_dispatch_required, before any lib work.
    const { db } = mockDb(); // empty select queue → agent not found
    const context = await mintContext();
    const result = await withSelfExtension(TENANT_ID, () =>
      handleCapabilityControl(
        {
          action: "self_admit_connection",
          callerContext: context,
          proposalId: "p-1",
        },
        { db, publicKeyPem },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("folder_dispatch_required");
  });

  it("passes the folder-dispatch gate for a capability-participating agent", async () => {
    // Agent carries the flag → the gate passes and control reaches the signer
    // (unconfigured in tests → signing_unavailable), proving the guard did not
    // block a valid capability-participating agent.
    const { db, selectQueue } = mockDb();
    selectQueue.push([{ capabilityFolderDispatch: true }]);
    const context = await mintContext();
    const result = await withSelfExtension(TENANT_ID, () =>
      handleCapabilityControl(
        {
          action: "self_admit_connection",
          callerContext: context,
          proposalId: "p-1",
        },
        { db, publicKeyPem },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error();
    expect(result.reason).toBe("signing_unavailable");
  });

  it("classifies descriptor-shaped rejections (authoring reference attach gate)", () => {
    // Validator-style violations → self-correctable, reference attaches.
    expect(
      isDescriptorShapedRejection("operations[0].latencyClass: invalid"),
    ).toBe(true);
    expect(
      isDescriptorShapedRejection("descriptor: missing from payload"),
    ).toBe(true);
    expect(
      isDescriptorShapedRejection("version: must be a decimal string"),
    ).toBe(true);
    expect(isDescriptorShapedRejection("adapter: invalid")).toBe(true);
    // Governance outcomes → re-authoring cannot convert them; no reference.
    expect(isDescriptorShapedRejection("held_for_review")).toBe(false);
    expect(isDescriptorShapedRejection("proposal_not_found")).toBe(false);
    expect(isDescriptorShapedRejection(undefined)).toBe(false);
  });
});
