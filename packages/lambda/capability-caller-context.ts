/**
 * Capability caller context — wire format + verifier (THINK-280 U2).
 *
 * The capability-control-service Lambda derives tenant/agent/actor identity
 * from a per-call Ed25519-signed caller context minted by the trusted host
 * (the API dispatch path — the Pi container holds only the capability
 * PUBLIC key and can never mint), NEVER from plaintext payload fields
 * asserted over the shared Pi role.
 *
 * This deliberately reuses the analyst caller-context machinery
 * (`analyst-caller-context.ts`): the same capability signing key, the same
 * canonicalization (`canonicalizeCallerContextPayload` is imported, not
 * re-implemented, so mint/verify bytes can never drift), the same envelope
 * shape. Domain separation is CRYPTOGRAPHIC and in-payload: the signed
 * `kind` tag is `capability-caller-context`, so an analyst context, a
 * signed sidecar, or any other payload under the shared key can never
 * verify as a capability caller context — and vice versa.
 *
 * Contexts are session-shaped (the Pi container reuses one context across
 * the tool calls of a run, mirroring the analyst session mode): no
 * bodyHash, expiry sized to the run ceiling (30 min).
 */

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { canonicalizeCallerContextPayload } from "./analyst-caller-context.js";

export const CAPABILITY_CALLER_CONTEXT_KIND = "capability-caller-context";

/** Session contexts cover a whole dispatched run (analyst session parity). */
export const CAPABILITY_CALLER_CONTEXT_TTL_MS = 30 * 60 * 1000;

/**
 * `agent` — a Pi turn acting for its own agent; `delegation` — a child
 * profile run acting under the parent turn's dispatch.
 */
export type CapabilityCallerActor = "agent" | "delegation";

export interface CapabilityCallerContextPayload {
  /** In-payload domain-separation tag — always the KIND constant. */
  kind: typeof CAPABILITY_CALLER_CONTEXT_KIND;
  tenantId: string;
  actor: CapabilityCallerActor;
  agentId: string;
  /** The human the turn acts for, when one exists (wakeups may omit). */
  actorUserId?: string;
  threadId?: string;
  /**
   * Resolved capability-manifest fingerprint at dispatch — the identity of
   * the projection the search must be answered from (U3+ consumes this;
   * verified-but-optional in this slice).
   */
  manifestFingerprint?: string;
  /** Epoch milliseconds. */
  iat: number;
  exp: number;
}

/**
 * Signature envelope — structurally the capability signature envelope
 * (sidecar-signing.ts / analyst-caller-context.ts). Only the canonicalized
 * payload is signed; envelope fields are transport.
 */
export interface CapabilityCallerContextSignature {
  version: number;
  algorithm: string;
  payloadHash: string;
  signature: string;
  signed_by: string;
  signed_at: string;
}

export function encodeCapabilityCallerContext(input: {
  payload: CapabilityCallerContextPayload;
  signature: CapabilityCallerContextSignature;
}): string {
  return Buffer.from(
    JSON.stringify({ payload: input.payload, signature: input.signature }),
    "utf8",
  ).toString("base64url");
}

export type CapabilityCallerContextVerifyResult =
  | { ok: true; payload: CapabilityCallerContextPayload }
  | { ok: false; reason: string };

/**
 * Verify an encoded capability caller context against the capability
 * PUBLIC key. Order mirrors the analyst verifier: structural parse →
 * signature over canonical payload → in-payload kind tag → identity
 * fields → expiry. Every failure returns a typed reason for structured
 * logging; callers respond with one uniform rejection.
 */
export function verifyCapabilityCallerContext(input: {
  contextValue: string;
  publicKeyPem: string;
  nowMs: number;
}): CapabilityCallerContextVerifyResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      Buffer.from(input.contextValue, "base64url").toString("utf8"),
    );
  } catch {
    return { ok: false, reason: "malformed_context" };
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return { ok: false, reason: "malformed_context" };
  }
  const { payload, signature } = decoded as {
    payload?: unknown;
    signature?: unknown;
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "malformed_payload" };
  }
  const envelope = parseSignatureEnvelope(signature);
  if (!envelope) {
    return { ok: false, reason: "malformed_signature" };
  }

  // Signature first: nothing in the payload is trusted until the canonical
  // bytes verify under the platform public key.
  const canonical = canonicalizeCallerContextPayload(payload);
  const payloadHash = createHash("sha256").update(canonical).digest("hex");
  if (payloadHash !== envelope.payloadHash) {
    return { ok: false, reason: "invalid_signature" };
  }
  let verified = false;
  try {
    verified = edVerify(
      null,
      Buffer.from(canonical, "utf8"),
      createPublicKey(input.publicKeyPem),
      Buffer.from(envelope.signature, "hex"),
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    return { ok: false, reason: "invalid_signature" };
  }

  const record = payload as Partial<CapabilityCallerContextPayload> &
    Record<string, unknown>;
  // In-payload domain separation: an analyst caller context (or any other
  // payload kind under the shared key) must never verify as a capability
  // caller context.
  if (record.kind !== CAPABILITY_CALLER_CONTEXT_KIND) {
    return { ok: false, reason: "wrong_kind" };
  }
  if (typeof record.tenantId !== "string" || record.tenantId.length === 0) {
    return { ok: false, reason: "missing_tenant" };
  }
  if (record.actor !== "agent" && record.actor !== "delegation") {
    return { ok: false, reason: "unknown_actor" };
  }
  if (typeof record.agentId !== "string" || record.agentId.length === 0) {
    return { ok: false, reason: "missing_agent" };
  }
  if (
    record.actorUserId !== undefined &&
    (typeof record.actorUserId !== "string" || record.actorUserId.length === 0)
  ) {
    return { ok: false, reason: "malformed_actor_user" };
  }
  if (
    record.manifestFingerprint !== undefined &&
    typeof record.manifestFingerprint !== "string"
  ) {
    return { ok: false, reason: "malformed_manifest_fingerprint" };
  }
  if (
    typeof record.exp !== "number" ||
    !Number.isFinite(record.exp) ||
    typeof record.iat !== "number" ||
    !Number.isFinite(record.iat)
  ) {
    return { ok: false, reason: "malformed_expiry" };
  }
  if (input.nowMs > record.exp) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload: record as CapabilityCallerContextPayload };
}

function parseSignatureEnvelope(
  raw: unknown,
): CapabilityCallerContextSignature | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Partial<CapabilityCallerContextSignature>;
  if (record.version !== 1) return null;
  if (record.algorithm !== "Ed25519") return null;
  if (
    typeof record.payloadHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(record.payloadHash)
  ) {
    return null;
  }
  if (
    typeof record.signature !== "string" ||
    !/^[a-f0-9]{128}$/i.test(record.signature)
  ) {
    return null;
  }
  if (typeof record.signed_by !== "string" || record.signed_by === "") {
    return null;
  }
  if (typeof record.signed_at !== "string") return null;
  return {
    version: 1,
    algorithm: "Ed25519",
    payloadHash: record.payloadHash.toLowerCase(),
    signature: record.signature.toLowerCase(),
    signed_by: record.signed_by,
    signed_at: record.signed_at,
  };
}
