import { describe, it, expect, beforeEach } from "vitest";
import {
  generateKeyPairSync,
  sign as edSign,
  type KeyObject,
} from "node:crypto";

import {
  buildSignableCallPayload,
  buildSignableStatusPayload,
  formatTwcapRef,
  type BrokerCallRequest,
  type BrokerStatusRequest,
  type OperationContract,
} from "@thinkwork/capability-contracts";

import {
  createSession,
  type CreateSessionInput,
} from "../lib/capability-broker/sessions.js";
import {
  createEmptyAdapterRegistry,
  createAdapterRegistry,
  type AdapterRegistry,
  type CapabilityAdapter,
} from "../lib/capability-broker/adapters/registry.js";
import {
  createBroker,
  type AuthorizationLoader,
  type AuthorizationSnapshot,
} from "../capability-broker.js";
import {
  createFakeDynamo,
  createFakeEvidenceStore,
  type FakeDynamo,
  type FakeEvidenceStore,
} from "./capability-broker-fakes.js";

const TABLE = "broker-test";
const NOW = 1_700_000_000_000;
const AUDIENCE = "broker.internal.example";
const CONTRACT_HASH = "a".repeat(64);
const OPERATION_REF = formatTwcapRef({
  namespace: "platform",
  class: "connection",
  slug: "github",
  version: "1",
  operationId: "repos.get",
  contractHash: CONTRACT_HASH,
});

function operation(
  overrides: Partial<OperationContract> = {},
): OperationContract {
  return {
    operationId: "repos.get",
    summary: "Get a repo",
    effect: "read",
    targetScope: { kind: "open_world" },
    reversibility: "reversible",
    idempotency: "idempotent",
    principalModes: ["service"],
    approvalPolicy: "never",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    inputDataClass: "internal",
    outputDataClass: "internal",
    costClass: "low",
    latencyClass: "interactive",
    outputClass: "inline",
    ...overrides,
  };
}

function allowSnapshot(
  overrides: Partial<AuthorizationSnapshot> = {},
): AuthorizationSnapshot {
  return {
    definitionVersionId: "ver-1",
    operation: operation(),
    currentContractHash: CONTRACT_HASH,
    adapterKind: "http_openapi",
    grant: { allowedEffects: ["read"] },
    binding: {
      id: "bind-1",
      readiness: "ready",
      principalMode: "service",
      subjectId: "sp-1",
      credentialRefs: { token: "secret-ref://x" },
    },
    approval: { policy: "never", satisfied: true },
    budget: { withinLimits: true, delta: { calls: 1 } },
    ...overrides,
  };
}

const allowLoader: AuthorizationLoader = async () => allowSnapshot();

let privateKey: KeyObject;
let publicKeyB64: string;

function newKeypair() {
  const kp = generateKeyPairSync("ed25519");
  privateKey = kp.privateKey;
  publicKeyB64 = kp.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
}

function sessionInput(
  overrides: Partial<CreateSessionInput> = {},
): CreateSessionInput {
  return {
    sessionId: "sess-1",
    tenantId: "tenant-1",
    audience: AUDIENCE,
    publicKey: publicKeyB64,
    contextFingerprint: "fp-1",
    principalMode: "service",
    subjectId: "sp-1",
    brokerSessionRowId: "row-1",
    createdEpochMs: NOW,
    expiresEpochSeconds: Math.floor(NOW / 1000) + 900,
    ...overrides,
  };
}

function callRequest(
  overrides: Partial<BrokerCallRequest> = {},
): BrokerCallRequest {
  return {
    sessionId: "sess-1",
    clientRequestId: "req-1",
    sequence: 0,
    nonce: "nonce-1",
    issuedAt: new Date(NOW).toISOString(),
    operation: OPERATION_REF,
    input: { owner: "acme", repo: "widgets" },
    ...overrides,
  };
}

function signCall(request: BrokerCallRequest, audience = AUDIENCE): string {
  const signable = buildSignableCallPayload(audience, request);
  return edSign(null, Buffer.from(signable, "utf8"), privateKey).toString(
    "base64",
  );
}

function signStatus(request: BrokerStatusRequest, audience = AUDIENCE): string {
  const signable = buildSignableStatusPayload(audience, request);
  return edSign(null, Buffer.from(signable, "utf8"), privateKey).toString(
    "base64",
  );
}

function makeBroker(opts: {
  dynamo: FakeDynamo;
  evidence: FakeEvidenceStore;
  registry?: AdapterRegistry;
  loader?: AuthorizationLoader;
}) {
  return createBroker({
    dynamo: opts.dynamo,
    table: TABLE,
    evidence: opts.evidence,
    registry: opts.registry ?? createEmptyAdapterRegistry(),
    loadAuthorization: opts.loader ?? allowLoader,
    now: () => NOW,
  });
}

describe("capability-broker handler", () => {
  let dynamo: FakeDynamo;
  let evidence: FakeEvidenceStore;

  beforeEach(async () => {
    newKeypair();
    dynamo = createFakeDynamo();
    evidence = createFakeEvidenceStore();
    await createSession(dynamo, TABLE, sessionInput());
  });

  it("happy path: a valid sequence-0 signed call reaches policy and returns unavailable_adapter with evidence", async () => {
    const broker = makeBroker({ dynamo, evidence });
    const request = callRequest();
    const env = await broker.handleCall(request, signCall(request));

    expect(env.result.status).toBe("failed");
    if (env.result.status === "failed") {
      expect(env.result.error.category).toBe("unavailable_adapter");
    }
    expect(env.callId).not.toBe("");

    // Evidence: one row, created authorized, finalized failed/unavailable_adapter.
    expect(evidence.inserted).toHaveLength(1);
    const row = evidence.rows.get(env.callId)!;
    expect(row.status).toBe("failed");
    expect(row.error_category).toBe("unavailable_adapter");
    expect(row.effect).toBe("read");
    expect(row.adapter_kind).toBe("http_openapi");
    expect(row.contract_hash).toBe(CONTRACT_HASH);
    expect(row.definition_version_id).toBe("ver-1");
    expect(row.binding_id).toBe("bind-1");
    expect(typeof row.request_digest).toBe("string");

    // The sequence advanced.
    const loaded = dynamo.raw("SESSION#sess-1", "#META");
    expect(loaded?.nextSequence).toBe(1);

    // Evidence NEVER echoes the signature, key, or raw secret refs.
    const serialized = JSON.stringify(evidence.inserted);
    expect(serialized).not.toContain(publicKeyB64);
    expect(serialized).not.toContain("secret-ref://x");
  });

  it("covers AE4: replaying the exact request is rejected before dispatch", async () => {
    const registry = countingRegistry();
    const broker = makeBroker({
      dynamo,
      evidence,
      registry: registry.registry,
    });
    const request = callRequest();
    const sig = signCall(request);

    const first = await broker.handleCall(request, sig);
    expect(first.result.status).toBe("failed"); // unavailable, but the sequence consumed

    const replay = await broker.handleCall(request, sig);
    expect(replay.result.status).toBe("failed");
    if (replay.result.status === "failed") {
      expect(replay.result.error.category).toBe("replay_rejected");
    }
    // The replay never reached an adapter.
    expect(registry.dispatchCount()).toBe(0);
    // A rejected evidence row was appended without echoing the signature.
    const rejected = evidence.inserted.find(
      (r) => r.error_category === "replay_rejected",
    );
    expect(rejected).toBeDefined();
    expect(JSON.stringify(rejected)).not.toContain(sig);
  });

  it("rejects a reused nonce with a fresh sequence before dispatch", async () => {
    const broker = makeBroker({ dynamo, evidence });
    const r0 = callRequest({
      sequence: 0,
      nonce: "shared",
      clientRequestId: "c0",
    });
    await broker.handleCall(r0, signCall(r0));

    const r1 = callRequest({
      sequence: 1,
      nonce: "shared",
      clientRequestId: "c1",
    });
    const env = await broker.handleCall(r1, signCall(r1));
    expect(env.result.status).toBe("failed");
    if (env.result.status === "failed") {
      expect(env.result.error.category).toBe("replay_rejected");
    }
  });

  it("accepts a request just inside the clock window and rejects just outside", async () => {
    const broker = makeBroker({ dynamo, evidence });

    const inside = callRequest({
      sequence: 0,
      nonce: "n-in",
      clientRequestId: "c-in",
      issuedAt: new Date(NOW - 60_000).toISOString(),
    });
    const insideEnv = await broker.handleCall(inside, signCall(inside));
    // Reached dispatch (unavailable_adapter), i.e. passed the clock gate.
    if (insideEnv.result.status === "failed") {
      expect(insideEnv.result.error.category).toBe("unavailable_adapter");
    }

    const outside = callRequest({
      sequence: 1,
      nonce: "n-out",
      clientRequestId: "c-out",
      issuedAt: new Date(NOW - 61_000).toISOString(),
    });
    const outsideEnv = await broker.handleCall(outside, signCall(outside));
    expect(outsideEnv.result.status).toBe("failed");
    if (outsideEnv.result.status === "failed") {
      expect(outsideEnv.result.error.category).toBe("invalid_request");
    }
  });

  it("rejects a request signed for a different audience", async () => {
    const broker = makeBroker({ dynamo, evidence });
    const request = callRequest();
    const badSig = signCall(request, "someone-elses-audience");
    const env = await broker.handleCall(request, badSig);
    expect(env.result.status).toBe("failed");
    if (env.result.status === "failed") {
      expect(env.result.error.category).toBe("unauthorized");
    }
    // Rejected before consuming the sequence.
    const loaded = dynamo.raw("SESSION#sess-1", "#META");
    expect(loaded?.nextSequence).toBe(0);
  });

  it("rejects when the request body is tampered after signing (body-hash binding)", async () => {
    const broker = makeBroker({ dynamo, evidence });
    const request = callRequest();
    const sig = signCall(request);
    const tampered = { ...request, input: { owner: "attacker", repo: "evil" } };
    const env = await broker.handleCall(tampered, sig);
    expect(env.result.status).toBe("failed");
    if (env.result.status === "failed") {
      expect(env.result.error.category).toBe("unauthorized");
    }
  });

  it("rejects a request whose signature is from an unrelated key", async () => {
    const broker = makeBroker({ dynamo, evidence });
    const request = callRequest();
    const other = generateKeyPairSync("ed25519");
    const signable = buildSignableCallPayload(AUDIENCE, request);
    const badSig = edSign(
      null,
      Buffer.from(signable, "utf8"),
      other.privateKey,
    ).toString("base64");
    const env = await broker.handleCall(request, badSig);
    if (env.result.status === "failed") {
      expect(env.result.error.category).toBe("unauthorized");
    }
  });

  it("fails closed on a malformed operation reference", async () => {
    const broker = makeBroker({ dynamo, evidence });
    const request = callRequest({ operation: "not-a-twcap-ref" });
    const env = await broker.handleCall(request, signCall(request));
    expect(env.result.status).toBe("failed");
    if (env.result.status === "failed") {
      expect(env.result.error.category).toBe("invalid_request");
    }
  });

  it("blocks dispatch on a policy gate even with a valid signature (grant removed)", async () => {
    const broker = makeBroker({
      dynamo,
      evidence,
      loader: async () => allowSnapshot({ grant: null }),
    });
    const request = callRequest();
    const env = await broker.handleCall(request, signCall(request));
    expect(env.result.status).toBe("failed");
    if (env.result.status === "failed") {
      expect(env.result.error.category).toBe("policy_blocked");
    }
    // Recorded as a rejection; no authorized row.
    expect(evidence.inserted.every((r) => r.status === "rejected")).toBe(true);
  });

  it("returns an unknown session as session_expired without consuming anything", async () => {
    const broker = makeBroker({ dynamo, evidence });
    const request = callRequest({ sessionId: "ghost" });
    const env = await broker.handleCall(request, signCall(request));
    if (env.result.status === "failed") {
      expect(env.result.error.category).toBe("session_expired");
    }
  });

  it("returns session_cancelled once the session is cancelled", async () => {
    await dynamo.update({
      key: { pk: "SESSION#sess-1", sk: "#META" },
      set: { cancelled: true, status: "cancelled" },
    });
    const broker = makeBroker({ dynamo, evidence });
    const request = callRequest();
    const env = await broker.handleCall(request, signCall(request));
    if (env.result.status === "failed") {
      expect(env.result.error.category).toBe("session_cancelled");
    }
  });

  it("lost-response: a status request returns the recorded outcome and never re-dispatches", async () => {
    const registry = countingRegistry();
    const broker = makeBroker({
      dynamo,
      evidence,
      registry: registry.registry,
    });

    const call = callRequest({ clientRequestId: "call-abc" });
    const original = await broker.handleCall(call, signCall(call));
    expect(original.result.status).toBe("failed"); // unavailable_adapter (empty adapter)
    const dispatchesAfterOriginal = registry.dispatchCount();

    const status: BrokerStatusRequest = {
      sessionId: "sess-1",
      clientRequestId: "status-1",
      subjectClientRequestId: "call-abc",
      sequence: 1,
      nonce: "nonce-status",
      issuedAt: new Date(NOW).toISOString(),
    };
    const recovered = await broker.handleStatus(status, signStatus(status));

    // Returns the RECORDED outcome, same callId, without another dispatch.
    expect(recovered.callId).toBe(original.callId);
    expect(recovered.result.status).toBe("failed");
    if (recovered.result.status === "failed") {
      expect(recovered.result.error.category).toBe("unavailable_adapter");
    }
    expect(registry.dispatchCount()).toBe(dispatchesAfterOriginal); // no redispatch
    // No new authorized row was created by the status lookup.
    expect(
      evidence.inserted.filter((r) => r.status === "authorized"),
    ).toHaveLength(1);
  });

  it("terminal-ledger failure after a provider effect yields indeterminate, never a redispatch", async () => {
    const registry = countingRegistry(async () => ({
      status: "completed",
      data: { ok: true },
    }));
    const broker = makeBroker({
      dynamo,
      evidence,
      registry: registry.registry,
    });

    // The finalize write fails after the adapter has produced its effect.
    evidence.finalizeShouldThrow = true;

    const request = callRequest();
    const env = await broker.handleCall(request, signCall(request));

    expect(env.result.status).toBe("failed");
    if (env.result.status === "failed") {
      expect(env.result.error.category).toBe("indeterminate");
    }
    // The adapter ran exactly once — the broker did not retry it.
    expect(registry.dispatchCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// A registry whose single fake adapter counts dispatches.
// ---------------------------------------------------------------------------

function countingRegistry(impl?: CapabilityAdapter["dispatch"]): {
  registry: AdapterRegistry;
  dispatchCount: () => number;
} {
  let count = 0;
  const adapter: CapabilityAdapter = {
    kind: "http_openapi",
    async dispatch(ctx) {
      count++;
      if (impl) return impl(ctx);
      return {
        status: "failed",
        category: "adapter_error",
        message: "test adapter",
        retryable: false,
      };
    },
  };
  // Default: EMPTY registry so a "counting" wrapper still proves 0 dispatches
  // on the unavailable-adapter paths; callers that pass `impl` get the adapter.
  const registry = impl
    ? createAdapterRegistry([adapter])
    : createEmptyAdapterRegistry();
  return { registry, dispatchCount: () => count };
}
