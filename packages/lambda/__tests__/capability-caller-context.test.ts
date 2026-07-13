/**
 * Capability caller-context wire format tests (THINK-280 U2).
 *
 * The broker-side trust checks (forged key, expired, analyst-kind) are
 * pinned again in packages/api's capability-control-service.test.ts via
 * the real minting helper; this suite pins the verifier's contract in
 * isolation — including that canonicalization is byte-shared with the
 * analyst module so mint/verify can never drift.
 */

import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import {
  CAPABILITY_CALLER_CONTEXT_KIND,
  encodeCapabilityCallerContext,
  verifyCapabilityCallerContext,
  type CapabilityCallerContextPayload,
  type CapabilityCallerContextSignature,
} from "../capability-caller-context.js";
import { canonicalizeCallerContextPayload } from "../analyst-caller-context.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

function sign(
  payload: Record<string, unknown>,
): CapabilityCallerContextSignature {
  const canonical = canonicalizeCallerContextPayload(payload);
  return {
    version: 1,
    algorithm: "Ed25519",
    payloadHash: createHash("sha256").update(canonical).digest("hex"),
    signature: edSign(
      null,
      Buffer.from(canonical, "utf8"),
      privateKey,
    ).toString("hex"),
    signed_by: "api-dispatch",
    signed_at: new Date().toISOString(),
  };
}

function payload(
  overrides: Partial<CapabilityCallerContextPayload> = {},
): CapabilityCallerContextPayload {
  const now = Date.now();
  return {
    kind: CAPABILITY_CALLER_CONTEXT_KIND,
    tenantId: "tenant-1",
    actor: "agent",
    agentId: "agent-1",
    actorUserId: "user-1",
    iat: now,
    exp: now + 60_000,
    ...overrides,
  };
}

function encode(p: CapabilityCallerContextPayload): string {
  return encodeCapabilityCallerContext({
    payload: p,
    signature: sign(p as unknown as Record<string, unknown>),
  });
}

describe("verifyCapabilityCallerContext", () => {
  it("verifies a well-formed signed context and returns the payload", () => {
    const p = payload({ manifestFingerprint: "b".repeat(64) });
    const result = verifyCapabilityCallerContext({
      contextValue: encode(p),
      publicKeyPem,
      nowMs: Date.now(),
    });
    expect(result).toEqual({ ok: true, payload: p });
  });

  it("rejects a payload mutated after signing (signature over canonical bytes)", () => {
    const p = payload();
    const signature = sign(p as unknown as Record<string, unknown>);
    const tampered = encodeCapabilityCallerContext({
      payload: { ...p, tenantId: "attacker-tenant" },
      signature,
    });
    const result = verifyCapabilityCallerContext({
      contextValue: tampered,
      publicKeyPem,
      nowMs: Date.now(),
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a wrong in-payload kind even when validly signed (domain separation)", () => {
    const p = payload({
      kind: "analyst-caller-context" as never,
    });
    const result = verifyCapabilityCallerContext({
      contextValue: encode(p),
      publicKeyPem,
      nowMs: Date.now(),
    });
    expect(result).toEqual({ ok: false, reason: "wrong_kind" });
  });

  it("rejects an expired context", () => {
    const now = Date.now();
    const p = payload({ iat: now - 120_000, exp: now - 60_000 });
    const result = verifyCapabilityCallerContext({
      contextValue: encode(p),
      publicKeyPem,
      nowMs: now,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a context missing the agent identity", () => {
    const p = payload();
    delete (p as unknown as Record<string, unknown>).agentId;
    const result = verifyCapabilityCallerContext({
      contextValue: encode(p),
      publicKeyPem,
      nowMs: Date.now(),
    });
    expect(result).toEqual({ ok: false, reason: "missing_agent" });
  });

  it("rejects garbage input as malformed", () => {
    const result = verifyCapabilityCallerContext({
      contextValue: "not-base64-json",
      publicKeyPem,
      nowMs: Date.now(),
    });
    expect(result).toEqual({ ok: false, reason: "malformed_context" });
  });
});
