/**
 * API-side capability caller-context minting (THINK-280 U2).
 *
 * Mints Ed25519-signed capability caller contexts at the trusted dispatch
 * sites (the same seam that mints analyst caller contexts — the Pi
 * container holds only the capability PUBLIC key and can never mint).
 * The wire format and verifier live in
 * `@thinkwork/lambda/capability-caller-context` (the capability-control
 * Lambda handler verifies through that module); minting reuses the
 * platform capability signer so key custody and canonical bytes stay
 * single-sourced. Domain separation from analyst contexts and sidecars is
 * the in-payload `kind: "capability-caller-context"` tag (signed bytes);
 * `signed_by: "api-dispatch"` is transport provenance only.
 *
 * Dispatch wiring note: the chat-agent-invoke AND wakeup-processor payload
 * builders must BOTH thread the minted value as `capability_caller_context`
 * (wakeup dispatch payload parity) — until they do, the Pi capability tools
 * report `caller_context_unavailable` and the control Lambda fails closed.
 */

import {
  CAPABILITY_CALLER_CONTEXT_KIND,
  CAPABILITY_CALLER_CONTEXT_TTL_MS,
  encodeCapabilityCallerContext,
  type CapabilityCallerActor,
  type CapabilityCallerContextPayload,
} from "@thinkwork/lambda/capability-caller-context";

import {
  resolveConfiguredCapabilitySigner,
  type CapabilitySigner,
} from "./sidecar-signing.js";

export {
  CAPABILITY_CALLER_CONTEXT_KIND,
  CAPABILITY_CALLER_CONTEXT_TTL_MS,
} from "@thinkwork/lambda/capability-caller-context";
export type { CapabilityCallerActor } from "@thinkwork/lambda/capability-caller-context";

/** Payload field the dispatch builders thread the minted context under. */
export const CAPABILITY_CALLER_CONTEXT_PAYLOAD_FIELD =
  "capability_caller_context";

export interface MintCapabilityCallerContextInput {
  actor: CapabilityCallerActor;
  tenantId: string;
  agentId: string;
  /** The human the turn acts for, when one exists (wakeups may omit). */
  actorUserId?: string;
  threadId?: string;
  /** Resolved capability-manifest fingerprint at dispatch, when known. */
  manifestFingerprint?: string;
  /** Override for tests; defaults to the session TTL. */
  ttlMs?: number;
  nowMs?: number;
  /** Injected signer for tests; defaults to the platform capability signer. */
  signer?: CapabilitySigner | null;
}

/**
 * Returns the encoded context value, or null when platform signing is
 * unavailable — callers must treat null as "capability tools disabled for
 * this dispatch" (the control Lambda rejects absent contexts fail-closed;
 * there is no unsigned fallback).
 */
export async function mintCapabilityCallerContext(
  input: MintCapabilityCallerContextInput,
): Promise<string | null> {
  const signer =
    input.signer !== undefined
      ? input.signer
      : await resolveConfiguredCapabilitySigner();
  if (!signer) return null;

  const now = input.nowMs ?? Date.now();
  const ttl = input.ttlMs ?? CAPABILITY_CALLER_CONTEXT_TTL_MS;

  const payload: CapabilityCallerContextPayload = {
    kind: CAPABILITY_CALLER_CONTEXT_KIND,
    tenantId: input.tenantId,
    actor: input.actor,
    agentId: input.agentId,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.manifestFingerprint
      ? { manifestFingerprint: input.manifestFingerprint }
      : {}),
    iat: now,
    exp: now + ttl,
  };

  const signature = signer.signPayload(
    payload as unknown as Record<string, unknown>,
    { signedBy: "api-dispatch" },
  );
  return encodeCapabilityCallerContext({ payload, signature });
}
