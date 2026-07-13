import { describe, it, expect, beforeEach } from "vitest";
import {
  generateKeyPairSync,
  sign as edSign,
  type KeyObject,
} from "node:crypto";

import {
  buildSignableCallPayload,
  formatTwcapRef,
  type BrokerCallRequest,
  type OperationContract,
} from "@thinkwork/capability-contracts";

import {
  createPassthroughCredentialResolver,
  createSecretsManagerCredentialResolver,
  type CredentialResolver,
} from "../lib/capability-broker/credential-resolver.js";
import {
  createAdapterRegistry,
  type CapabilityAdapter,
} from "../lib/capability-broker/adapters/registry.js";
import {
  createSession,
  type CreateSessionInput,
} from "../lib/capability-broker/sessions.js";
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

// ---------------------------------------------------------------------------
// Unit tests for the resolvers
// ---------------------------------------------------------------------------

describe("credential resolvers", () => {
  it("passthrough is a no-op that never reads the vault (empty credentials, always ok)", async () => {
    const r = createPassthroughCredentialResolver();
    expect(await r.resolveCredentialRefs({})).toEqual({
      ok: true,
      credentials: {},
    });
    // A non-empty ref map still resolves to NO handles — the default never
    // touches Secrets Manager; the real resolver must be injected to resolve.
    expect(await r.resolveCredentialRefs({ github: "ref://x" })).toEqual({
      ok: true,
      credentials: {},
    });
  });

  it("SecretsManager resolver decodes each reference into a payload object", async () => {
    const r = createSecretsManagerCredentialResolver({
      getSecretValue: async (ref) => {
        if (ref === "ref://gh") return JSON.stringify({ token: "ghp_live" });
        return null;
      },
    });
    const out = await r.resolveCredentialRefs({ github: "ref://gh" });
    expect(out).toEqual({
      ok: true,
      credentials: { github: { token: "ghp_live" } },
    });
  });

  it("fails closed (readiness_blocked) with a generic message that never echoes the ref or secret", async () => {
    const r = createSecretsManagerCredentialResolver({
      getSecretValue: async () => {
        throw new Error(
          "AccessDenied on arn:aws:secretsmanager:...:secret-xyz",
        );
      },
    });
    const out = await r.resolveCredentialRefs({ github: "ref://super-secret" });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.category).toBe("readiness_blocked");
      expect(out.message).not.toContain("super-secret");
      expect(out.message).not.toContain("arn:aws");
    }
  });

  it("fails closed on a missing / non-object / non-JSON secret", async () => {
    const missing = createSecretsManagerCredentialResolver({
      getSecretValue: async () => null,
    });
    expect((await missing.resolveCredentialRefs({ a: "r" })).ok).toBe(false);

    const notJson = createSecretsManagerCredentialResolver({
      getSecretValue: async () => "not-json",
    });
    expect((await notJson.resolveCredentialRefs({ a: "r" })).ok).toBe(false);

    const notObject = createSecretsManagerCredentialResolver({
      getSecretValue: async () => JSON.stringify(["x"]),
    });
    expect((await notObject.resolveCredentialRefs({ a: "r" })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Broker integration: resolution failure => no dispatch; secrets never in evidence
// ---------------------------------------------------------------------------

const TABLE = "broker-cred-test";
const NOW = 1_700_000_000_000;
const AUDIENCE = "broker.internal.example";
const CONTRACT_HASH = "c".repeat(64);
const OPERATION_REF = formatTwcapRef({
  namespace: "acme",
  class: "connection",
  slug: "github-rest",
  version: "1",
  operationId: "issues.list",
  contractHash: CONTRACT_HASH,
});

function operation(): OperationContract {
  return {
    operationId: "issues.list",
    summary: "List issues",
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
  };
}

function allowSnapshot(): AuthorizationSnapshot {
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
      credentialRefs: { github: "secret-ref://SENSITIVE" },
    },
    approval: { policy: "never", satisfied: true },
    budget: { withinLimits: true, delta: { calls: 1 } },
  };
}

const allowLoader: AuthorizationLoader = async () => allowSnapshot();

let privateKey: KeyObject;
let publicKeyB64: string;

function sessionInput(): CreateSessionInput {
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
    input: { state: "open" },
    ...overrides,
  };
}

function signCall(request: BrokerCallRequest): string {
  const signable = buildSignableCallPayload(AUDIENCE, request);
  return edSign(null, Buffer.from(signable, "utf8"), privateKey).toString(
    "base64",
  );
}

/** A registry whose http_openapi adapter echoes the resolved secret in its result. */
function echoingRegistry(): {
  registry: ReturnType<typeof createAdapterRegistry>;
  dispatched: () => number;
} {
  let count = 0;
  const adapter: CapabilityAdapter = {
    kind: "http_openapi",
    async dispatch(ctx) {
      count++;
      // Echo the secret the resolver produced — the broker must never persist it.
      const token = (ctx.credentials.github as { token?: string })?.token;
      return { status: "completed", data: { echoedToken: token ?? null } };
    },
  };
  return {
    registry: createAdapterRegistry([adapter]),
    dispatched: () => count,
  };
}

describe("broker credential-resolution seam", () => {
  let dynamo: FakeDynamo;
  let evidence: FakeEvidenceStore;

  beforeEach(async () => {
    const kp = generateKeyPairSync("ed25519");
    privateKey = kp.privateKey;
    publicKeyB64 = kp.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64");
    dynamo = createFakeDynamo();
    evidence = createFakeEvidenceStore();
    await createSession(dynamo, TABLE, sessionInput());
  });

  it("a resolver failure yields a typed failure and NO dispatch", async () => {
    const reg = echoingRegistry();
    const failingResolver: CredentialResolver = {
      async resolveCredentialRefs() {
        return {
          ok: false,
          category: "readiness_blocked",
          message: "credential resolution failed",
        };
      },
    };
    const broker = createBroker({
      dynamo,
      table: TABLE,
      evidence,
      registry: reg.registry,
      loadAuthorization: allowLoader,
      credentialResolver: failingResolver,
      now: () => NOW,
    });
    const req = callRequest();
    const env = await broker.handleCall(req, signCall(req));

    expect(env.result.status).toBe("failed");
    if (env.result.status === "failed") {
      expect(env.result.error.category).toBe("readiness_blocked");
    }
    // The adapter was never reached.
    expect(reg.dispatched()).toBe(0);
  });

  it("resolved secrets are handed to the adapter but never appear in evidence", async () => {
    const reg = echoingRegistry();
    const SECRET = "ghp_TOPSECRETtoken0123456789";
    const resolver: CredentialResolver = {
      async resolveCredentialRefs() {
        return { ok: true, credentials: { github: { token: SECRET } } };
      },
    };
    const broker = createBroker({
      dynamo,
      table: TABLE,
      evidence,
      registry: reg.registry,
      loadAuthorization: allowLoader,
      credentialResolver: resolver,
      now: () => NOW,
    });
    const req = callRequest();
    const env = await broker.handleCall(req, signCall(req));

    expect(env.result.status).toBe("completed");
    expect(reg.dispatched()).toBe(1);

    // The adapter received the resolved secret (proving resolution happened)...
    if (env.result.status === "completed") {
      expect(env.result.data).toEqual({ echoedToken: SECRET });
    }
    // ...but the durable evidence rows never contain the secret NOR the vault ref.
    const serialized = JSON.stringify(evidence.inserted);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("secret-ref://SENSITIVE");
  });
});
