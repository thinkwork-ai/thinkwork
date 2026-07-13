import type { CanonicalJson } from "./canonical";

/**
 * Broker request/result envelopes (THINK-280 KTD "Broker results").
 *
 * Results are `completed`, `accepted`, or `failed`. Inline validated data is
 * capped at 64 KiB; larger output becomes a durable Artifact/S3 reference.
 * `accepted` never pretends asynchronous provider durability is synchronous —
 * it must identify how the trusted runtime polls/cancels.
 */

export const BROKER_RESULT_STATUSES = [
  "completed",
  "accepted",
  "failed",
] as const;
export type BrokerResultStatus = (typeof BROKER_RESULT_STATUSES)[number];

export const BROKER_ERROR_CATEGORIES = [
  "invalid_request",
  "unauthorized",
  "replay_rejected",
  "session_expired",
  "session_cancelled",
  "policy_blocked",
  "approval_required",
  "readiness_blocked",
  "budget_exhausted",
  "unavailable_adapter",
  "adapter_error",
  "provider_error",
  "rate_limited",
  "timeout",
  "cancelled",
  "indeterminate",
] as const;
export type BrokerErrorCategory = (typeof BROKER_ERROR_CATEGORIES)[number];

/** Contract ceiling for inline result payloads (canonical UTF-8 bytes). */
export const INLINE_RESULT_MAX_BYTES = 64 * 1024;

export interface DurableResultReference {
  kind: "artifact" | "s3";
  /** Opaque platform reference (artifact id or bucket/key ref) — never a signed URL. */
  ref: string;
  contentType?: string;
  byteLength?: number;
}

export interface BrokerCallRequest {
  sessionId: string;
  /** Unique within the session; the lost-response status lookup keys on it. */
  clientRequestId: string;
  /** Strict next sequence for the session; consumed atomically by the broker. */
  sequence: number;
  /** Unique nonce for replay rejection. */
  nonce: string;
  /** RFC 3339 UTC timestamp; must be within the broker clock window. */
  issuedAt: string;
  /** Exact `twcap:` operation reference being invoked. */
  operation: string;
  input: CanonicalJson;
}

/** Signed status lookup after an ambiguous network failure — never redispatches. */
export interface BrokerStatusRequest {
  sessionId: string;
  clientRequestId: string;
  /** The original call's clientRequestId whose recorded outcome is requested. */
  subjectClientRequestId: string;
  sequence: number;
  nonce: string;
  issuedAt: string;
}

export interface BrokerError {
  category: BrokerErrorCategory;
  retryable: boolean;
  /** Safe operator/agent-readable message; never provider internals or secrets. */
  message: string;
}

export type BrokerCallResult =
  | {
      status: "completed";
      /** Present when the validated output fits the inline cap. */
      data?: CanonicalJson;
      /** Present when output exceeded the inline cap or is inherently durable. */
      durableRef?: DurableResultReference;
    }
  | {
      status: "accepted";
      /** How the trusted runtime polls for completion (broker-scoped token). */
      pollToken: string;
      /** Whether the broker supports cancelling the accepted work. */
      cancellable: boolean;
    }
  | {
      status: "failed";
      error: BrokerError;
    };

export interface BrokerCallEnvelope {
  /** Broker-assigned durable evidence id for this call. */
  callId: string;
  sessionId: string;
  clientRequestId: string;
  operation: string;
  result: BrokerCallResult;
}

export class BrokerEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrokerEnvelopeError";
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Fail-closed parse of a broker call result received by an SDK/runtime. */
export function parseBrokerCallResult(value: unknown): BrokerCallResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BrokerEnvelopeError("result: not an object");
  }
  const r = value as Record<string, unknown>;
  switch (r.status) {
    case "completed": {
      if (r.data !== undefined && r.durableRef !== undefined) {
        throw new BrokerEnvelopeError(
          "completed: data and durableRef are exclusive",
        );
      }
      if (r.durableRef !== undefined) {
        const d = r.durableRef as Record<string, unknown>;
        if (
          (d.kind !== "artifact" && d.kind !== "s3") ||
          !isNonEmptyString(d.ref)
        ) {
          throw new BrokerEnvelopeError("completed: invalid durableRef");
        }
      }
      return value as BrokerCallResult;
    }
    case "accepted": {
      if (
        !isNonEmptyString(r.pollToken) ||
        typeof r.cancellable !== "boolean"
      ) {
        throw new BrokerEnvelopeError(
          "accepted: pollToken and cancellable required",
        );
      }
      return value as BrokerCallResult;
    }
    case "failed": {
      const e = r.error as Record<string, unknown> | undefined;
      if (
        !e ||
        !BROKER_ERROR_CATEGORIES.includes(e.category as BrokerErrorCategory) ||
        typeof e.retryable !== "boolean" ||
        typeof e.message !== "string"
      ) {
        throw new BrokerEnvelopeError("failed: invalid error");
      }
      return value as BrokerCallResult;
    }
    default:
      throw new BrokerEnvelopeError("result: unknown status");
  }
}
