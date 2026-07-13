import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
} from "node:crypto";

import {
  buildSignableCallPayload,
  SESSION_MAX_TTL_SECONDS,
  type BrokerCallRequest,
} from "@thinkwork/capability-contracts";
import type {
  DynamoPort,
  DynamoPutInput,
  DynamoUpdateInput,
  DynamoWriteResult,
} from "@thinkwork/lambda/capability-broker/sessions";

import { openBrokerSession } from "./broker-session.js";

const NOW = 1_700_000_000_000;
const TABLE = "broker-session-test";

function fakeDynamo(): DynamoPort & {
  store: Map<string, Record<string, unknown>>;
} {
  const store = new Map<string, Record<string, unknown>>();
  const key = (pk: string, sk: string) => `${pk} ${sk}`;
  return {
    store,
    async put(input: DynamoPutInput): Promise<DynamoWriteResult> {
      const k = key(String(input.item.pk), String(input.item.sk));
      if (input.condition?.kind === "attribute_not_exists" && store.has(k)) {
        return { ok: false, conditionFailed: true };
      }
      store.set(k, { ...input.item });
      return { ok: true };
    },
    async get(k) {
      const item = store.get(key(k.pk, k.sk));
      return item ? { ...item } : null;
    },
    async update(input: DynamoUpdateInput): Promise<DynamoWriteResult> {
      const k = key(input.key.pk, input.key.sk);
      const existing = store.get(k) ?? {};
      store.set(k, { ...existing, ...input.set });
      return { ok: true };
    },
    async delete() {},
  };
}

describe("openBrokerSession (trusted control plane)", () => {
  beforeEach(() => {
    process.env.CAPABILITY_BROKER_AUDIENCE = "broker.internal.example";
    process.env.CAPABILITY_BROKER_VPCE_DNS =
      "vpce-abc123.execute-api.us-east-1.vpce.amazonaws.com";
    process.env.CAPABILITY_BROKER_API_ID = "priv-api-42";
  });
  afterEach(() => {
    delete process.env.CAPABILITY_BROKER_AUDIENCE;
    delete process.env.CAPABILITY_BROKER_VPCE_DNS;
    delete process.env.CAPABILITY_BROKER_API_ID;
  });

  it("mints an ephemeral session, registers only the public key, and returns a bootstrap with the private key", async () => {
    const dynamo = fakeDynamo();
    const result = await openBrokerSession({
      tenantId: "tenant-1",
      contextFingerprint: "fp-1",
      principal: { mode: "service", subjectId: "sp-1" },
      brokerSessionRowId: "row-1",
      store: dynamo,
      tableName: TABLE,
      now: () => NOW,
    });

    // Bootstrap carries endpoint placeholders from env + the private key.
    expect(result.bootstrap.brokerEndpoint).toBe(
      "vpce-abc123.execute-api.us-east-1.vpce.amazonaws.com",
    );
    expect(result.bootstrap.brokerApiId).toBe("priv-api-42");
    expect(result.bootstrap.audience).toBe("broker.internal.example");
    expect(result.bootstrap.nextSequence).toBe(0);
    expect(result.bootstrap.privateKey.length).toBeGreaterThan(0);

    // The stored DynamoDB item has the PUBLIC key but never the private key.
    const stored = dynamo.store.get(`SESSION#${result.sessionId} #META`);
    expect(stored?.publicKey).toBe(result.publicKey);
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(result.bootstrap.privateKey);
    expect(stored?.principalMode).toBe("service");
    expect(stored?.nextSequence).toBe(0);
    expect(stored?.status).toBe("active");
  });

  it("caps the TTL at 15 minutes even when a longer TTL is requested", async () => {
    const dynamo = fakeDynamo();
    const result = await openBrokerSession({
      tenantId: "tenant-1",
      contextFingerprint: "fp-1",
      principal: { mode: "service", subjectId: "sp-1" },
      brokerSessionRowId: "row-1",
      ttlSeconds: 3600,
      store: dynamo,
      tableName: TABLE,
      now: () => NOW,
    });
    const expiresMs = Date.parse(result.expiresAt);
    expect(expiresMs).toBe(NOW + SESSION_MAX_TTL_SECONDS * 1000);
    const stored = dynamo.store.get(`SESSION#${result.sessionId} #META`);
    expect(stored?.ttl).toBe(Math.floor(NOW / 1000) + SESSION_MAX_TTL_SECONDS);
  });

  it("produces a keypair whose private key signs a payload the stored public key verifies", async () => {
    const dynamo = fakeDynamo();
    const result = await openBrokerSession({
      tenantId: "tenant-1",
      contextFingerprint: "fp-1",
      principal: { mode: "service", subjectId: "sp-1" },
      brokerSessionRowId: "row-1",
      sessionId: "sess-verify",
      store: dynamo,
      tableName: TABLE,
      now: () => NOW,
    });

    const request: BrokerCallRequest = {
      sessionId: "sess-verify",
      clientRequestId: "req-1",
      sequence: 0,
      nonce: "n-1",
      issuedAt: new Date(NOW).toISOString(),
      operation:
        "twcap://platform/connection/github/versions/1/operations/repos.get?contract=sha256:" +
        "a".repeat(64),
      input: { owner: "acme" },
    };
    const signable = buildSignableCallPayload(
      result.bootstrap.audience,
      request,
    );

    const priv = createPrivateKey({
      key: Buffer.from(result.bootstrap.privateKey, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const signature = edSign(null, Buffer.from(signable, "utf8"), priv);

    const pub = createPublicKey({
      key: Buffer.from(result.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    expect(edVerify(null, Buffer.from(signable, "utf8"), pub, signature)).toBe(
      true,
    );
  });

  it("fails closed when the VPCE endpoint placeholder is unavailable", async () => {
    delete process.env.CAPABILITY_BROKER_VPCE_DNS;
    const dynamo = fakeDynamo();
    await expect(
      openBrokerSession({
        tenantId: "tenant-1",
        contextFingerprint: "fp-1",
        principal: { mode: "service", subjectId: "sp-1" },
        brokerSessionRowId: "row-1",
        store: dynamo,
        tableName: TABLE,
        now: () => NOW,
      }),
    ).rejects.toThrow(/VPCE/);
  });
});
