import {
  type CanonicalJson,
  canonicalSha256Hex,
  canonicalize,
} from "./canonical";
import type { BrokerCallRequest, BrokerStatusRequest } from "./envelope";

/**
 * Proof-of-possession broker sessions (THINK-280 KTD "Proof of possession").
 *
 * Ed25519 over a domain-separated RFC 8785 canonical payload; strict next
 * sequence; unique nonce; 60-second clock window; at most 15-minute TTL.
 * Domain separation is an in-payload `kind` tag inside the signed bytes —
 * the analyst-caller-context pattern — so a shared trust root can never
 * confuse a broker request with any other signed payload.
 */

export const SESSION_MAX_TTL_SECONDS = 15 * 60;
export const REQUEST_CLOCK_WINDOW_SECONDS = 60;

export const BROKER_REQUEST_KIND = "twcap-broker-request" as const;
export const BROKER_STATUS_KIND = "twcap-broker-status" as const;

export interface BrokerSessionDescriptor {
  sessionId: string;
  tenantId: string;
  /** Audience the session is bound to (the broker endpoint identity). */
  audience: string;
  /** Base64-encoded Ed25519 public key registered by the trusted host. */
  publicKey: string;
  /** Fingerprint of the invocation projection/manifest the session was minted from. */
  contextFingerprint: string;
  /** Explicit principal selection for the session — no fallback across modes. */
  principal: {
    mode: "requester" | "agent_owner" | "service";
    subjectId: string;
  };
  /** RFC 3339 UTC expiry; never more than SESSION_MAX_TTL_SECONDS from mint. */
  expiresAt: string;
}

/**
 * The exact canonical payload an SDK signs for a broker call. The signature
 * covers the audience, full request identity, and the canonical hash of the
 * request body — nothing outside these fields (transport envelope fields are
 * deliberately uncovered, matching the analyst-caller-context precedent).
 */
export function buildSignableCallPayload(
  audience: string,
  request: BrokerCallRequest,
): string {
  const payload: CanonicalJson = {
    kind: BROKER_REQUEST_KIND,
    audience,
    sessionId: request.sessionId,
    clientRequestId: request.clientRequestId,
    sequence: request.sequence,
    nonce: request.nonce,
    issuedAt: request.issuedAt,
    operation: request.operation,
    bodyHash: canonicalSha256Hex(request.input),
  };
  return canonicalize(payload);
}

/** Canonical payload for a signed status lookup (lost-response recovery). */
export function buildSignableStatusPayload(
  audience: string,
  request: BrokerStatusRequest,
): string {
  const payload: CanonicalJson = {
    kind: BROKER_STATUS_KIND,
    audience,
    sessionId: request.sessionId,
    clientRequestId: request.clientRequestId,
    subjectClientRequestId: request.subjectClientRequestId,
    sequence: request.sequence,
    nonce: request.nonce,
    issuedAt: request.issuedAt,
  };
  return canonicalize(payload);
}

export type ClockCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "issued_in_future" | "outside_window" | "malformed_timestamp";
    };

/**
 * Validate a request timestamp against the broker clock window. Pure so both
 * TypeScript broker and Python SDK fixtures can share vectors; the caller
 * supplies "now" (epoch milliseconds).
 */
export function checkClockWindow(
  issuedAt: string,
  nowEpochMs: number,
): ClockCheck {
  const t = Date.parse(issuedAt);
  if (Number.isNaN(t)) return { ok: false, reason: "malformed_timestamp" };
  const skewMs = nowEpochMs - t;
  if (skewMs < -REQUEST_CLOCK_WINDOW_SECONDS * 1000) {
    return { ok: false, reason: "issued_in_future" };
  }
  if (skewMs > REQUEST_CLOCK_WINDOW_SECONDS * 1000) {
    return { ok: false, reason: "outside_window" };
  }
  return { ok: true };
}

/**
 * Session bootstrap payload the trusted host writes into a Code Interpreter
 * session (reserved path, chmod 0600). Contains the endpoint-specific VPCE
 * DNS name and private API id — never a provider credential; the private key
 * here is the short-lived bounded session capability only.
 */
export interface SessionBootstrap {
  sessionId: string;
  audience: string;
  /** Endpoint-specific VPCE DNS name (private DNS is disabled — THINK-144). */
  brokerEndpoint: string;
  /** Private REST API id targeted through the VPCE. */
  brokerApiId: string;
  /** Base64-encoded Ed25519 private key (session-scoped, ≤15 min). */
  privateKey: string;
  /** Next sequence to allocate (starts at 0). */
  nextSequence: number;
  expiresAt: string;
  /**
   * Path the sandbox POSTs to, INCLUDING the API Gateway stage — the broker is
   * a REST API whose proxy resource lives at `/{stage}/{proxy+}`, so a bare `/`
   * (the SDK default) is an unmatched route and API Gateway answers 403. Omit
   * only in tests that stub the transport.
   */
  invokePath?: string;
}
