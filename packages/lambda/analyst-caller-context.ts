/**
 * Analyst caller context — shared wire format + verifier (THINK-229 U2).
 *
 * Replaces the static tenant-wide broker bearer with a per-invocation
 * Ed25519-signed caller context minted API-side (trusted handlers only)
 * and verified in the analyst-query-broker Lambda. Signing rides the
 * capability signing key (KTD3): same custody, same trust root — domain
 * separation is CRYPTOGRAPHIC, not cosmetic. The existing capability
 * signer covers only the canonicalized payload (the envelope
 * `version`/`signed_by` are NOT in the signed bytes), so the `kind` tag
 * lives INSIDE the canonicalized payload and the verifier rejects any
 * payload whose `kind` is not the caller-context tag — a signed sidecar
 * can never verify as a caller context under the shared key, and vice
 * versa.
 *
 * Two context modes (a deliberate refinement of the plan's single
 * ≤5-minute bodyHash-bound shape — the dispatch transport made that
 * impossible on one path):
 *
 *   - **Session context** (actor `agent`/`delegation`, minted at MCP
 *     dispatch): the Pi container reuses ONE static header across every
 *     JSON-RPC request of a delegated run, so the request body is
 *     unknowable at mint time — no `bodyHash`, expiry sized to the run
 *     ceiling (30 min). Still a massive tightening over the static
 *     forever-bearer it replaces.
 *   - **Request-bound context** (actor `system_refresh`, minted by the
 *     headless canvas-refresh path per POST): carries `bodyHash`
 *     (sha256 of the exact JSON-RPC body) + ≤5-minute expiry. A captured
 *     context can only replay the identical read-only query within its
 *     window — bounded, audited, harmless against a SELECT-only role.
 *     `bodyHash` is REQUIRED for `system_refresh`.
 *
 * This module lives in @thinkwork/lambda because packages/lambda must
 * not import @thinkwork/api (bundling rule) while packages/api already
 * depends on @thinkwork/lambda — the API-side minting helper wraps this
 * module, so canonicalization can never drift between mint and verify.
 */

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";

export const ANALYST_CALLER_CONTEXT_KIND = "analyst-caller-context";
export const ANALYST_CALLER_CONTEXT_HEADER = "x-thinkwork-caller-context";

/** Session contexts cover a whole delegated run (static dispatch header). */
export const ANALYST_SESSION_CONTEXT_TTL_MS = 30 * 60 * 1000;
/** Request-bound contexts cover exactly one body-hashed POST. */
export const ANALYST_REQUEST_CONTEXT_TTL_MS = 5 * 60 * 1000;

export type AnalystCallerActor = "agent" | "delegation" | "system_refresh";

/** TLS posture for an external analyst data source (THINK-239). */
export type AnalystSourceTls = "verify-full" | "required";

/**
 * Source claims (THINK-239) — the signed description of the EXTERNAL Postgres
 * data source a sourced broker request (`POST /mcp/analyst/{sourceSlug}`) must
 * connect to. Absent on builtin (`POST /mcp/analyst`) requests, which keep
 * connecting via the cluster-global `analyst_reader` chain (back-compat).
 *
 * These ride inside the signed caller-context payload, so a caller cannot
 * point the broker at an attacker-controlled host/credential without the
 * platform signing key: the broker rejects a sourced path whose signed
 * `sourceClaims.slug` does not exactly match the path slug.
 */
export interface AnalystSourceClaims {
  /** Registry slug; MUST equal the `{sourceSlug}` path parameter. */
  slug: string;
  host: string;
  port: number;
  database: string;
  dbUser: string;
  /** `verify-full` (default) or `required` (encrypt, skip cert verification). */
  tls: AnalystSourceTls;
  /** Secrets Manager ARN/name of the source's reader credential. */
  credentialSecretArn: string;
  /** Whether the source is scoped to a single tenant (informational). */
  tenantScoped: boolean;
}

export interface AnalystCallerContextPayload {
  /** In-payload domain-separation tag (KTD3) — always the KIND constant. */
  kind: typeof ANALYST_CALLER_CONTEXT_KIND;
  tenantId: string;
  actor: AnalystCallerActor;
  agentId?: string;
  threadId?: string;
  refreshId?: string;
  /**
   * Sidecar-derived per-call policy the broker must honor (KTD7) —
   * populated by U3/U4; empty object until then.
   */
  policyClaims: Record<string, unknown>;
  /**
   * External data-source description (THINK-239). Present only for sourced
   * requests (`POST /mcp/analyst/{sourceSlug}`); absent = builtin source.
   * Canonicalized/signed like every other payload field.
   */
  sourceClaims?: AnalystSourceClaims;
  /** Epoch milliseconds. */
  iat: number;
  exp: number;
  /**
   * sha256 hex of the exact JSON-RPC request body. Required for
   * `system_refresh`; absent on session contexts (see module docs).
   */
  bodyHash?: string;
}

/**
 * Signature envelope — structurally the capability signature envelope
 * (packages/api/src/lib/capabilities/sidecar-signing.ts). Only the
 * canonicalized payload is signed; envelope fields are transport.
 */
export interface AnalystCallerContextSignature {
  version: number;
  algorithm: string;
  payloadHash: string;
  signature: string;
  signed_by: string;
  signed_at: string;
}

/**
 * Canonical JSON: recursively key-sorted, no whitespace, undefined
 * dropped. MUST stay byte-identical to `canonicalizePayload` in
 * sidecar-signing.ts — the API mints through that signer and this module
 * verifies. A cross-package parity test in packages/api pins this.
 */
export function canonicalizeCallerContextPayload(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      out[key] = sortValue(record[key]);
    }
    return out;
  }
  return value;
}

/** sha256 hex of the exact JSON-RPC body bytes as sent. */
export function hashAnalystRequestBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function encodeAnalystCallerContextHeader(input: {
  payload: AnalystCallerContextPayload;
  signature: AnalystCallerContextSignature;
}): string {
  return Buffer.from(
    JSON.stringify({ payload: input.payload, signature: input.signature }),
    "utf8",
  ).toString("base64url");
}

export type AnalystCallerContextVerifyResult =
  | { ok: true; payload: AnalystCallerContextPayload }
  | { ok: false; reason: string };

/**
 * Verify a caller-context header against the capability PUBLIC key.
 * Order: structural parse → signature over canonical payload → in-payload
 * kind tag → expiry → request binding. Every failure returns a typed
 * reason for the broker's structured log; the HTTP response stays a
 * uniform 401.
 */
export function verifyAnalystCallerContextHeader(input: {
  headerValue: string;
  requestBody: string;
  publicKeyPem: string;
  nowMs: number;
}): AnalystCallerContextVerifyResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      Buffer.from(input.headerValue, "base64url").toString("utf8"),
    );
  } catch {
    return { ok: false, reason: "malformed_header" };
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return { ok: false, reason: "malformed_header" };
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

  // Signature first: nothing in the payload is trusted until the
  // canonical bytes verify under the platform public key.
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

  const record = payload as Partial<AnalystCallerContextPayload> &
    Record<string, unknown>;
  // In-payload domain separation (KTD3): a signed sidecar (or any other
  // payload kind under the shared key) must never verify as a caller
  // context.
  if (record.kind !== ANALYST_CALLER_CONTEXT_KIND) {
    return { ok: false, reason: "wrong_kind" };
  }
  if (typeof record.tenantId !== "string" || record.tenantId.length === 0) {
    return { ok: false, reason: "missing_tenant" };
  }
  if (
    record.actor !== "agent" &&
    record.actor !== "delegation" &&
    record.actor !== "system_refresh"
  ) {
    return { ok: false, reason: "unknown_actor" };
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
  if (
    typeof record.policyClaims !== "object" ||
    record.policyClaims === null ||
    Array.isArray(record.policyClaims)
  ) {
    return { ok: false, reason: "malformed_policy_claims" };
  }

  // THINK-239: source claims are optional (absent = builtin), but a present
  // block must be well-formed — the broker binds the path slug to it.
  if (
    record.sourceClaims !== undefined &&
    !isValidSourceClaims(record.sourceClaims)
  ) {
    return { ok: false, reason: "malformed_source_claims" };
  }

  // Request binding: required for system_refresh, enforced when present.
  if (record.actor === "system_refresh" && !record.bodyHash) {
    return { ok: false, reason: "missing_body_hash" };
  }
  if (record.bodyHash !== undefined) {
    if (typeof record.bodyHash !== "string") {
      return { ok: false, reason: "malformed_body_hash" };
    }
    const actual = hashAnalystRequestBody(input.requestBody);
    if (record.bodyHash.toLowerCase() !== actual) {
      return { ok: false, reason: "body_hash_mismatch" };
    }
  }

  return { ok: true, payload: record as AnalystCallerContextPayload };
}

/** Structural validation of a present sourceClaims block (THINK-239). */
export function isValidSourceClaims(
  value: unknown,
): value is AnalystSourceClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.slug === "string" &&
    c.slug.length > 0 &&
    typeof c.host === "string" &&
    c.host.length > 0 &&
    typeof c.port === "number" &&
    Number.isFinite(c.port) &&
    typeof c.database === "string" &&
    c.database.length > 0 &&
    typeof c.dbUser === "string" &&
    c.dbUser.length > 0 &&
    (c.tls === "verify-full" || c.tls === "required") &&
    typeof c.credentialSecretArn === "string" &&
    c.credentialSecretArn.length > 0 &&
    typeof c.tenantScoped === "boolean"
  );
}

function parseSignatureEnvelope(
  raw: unknown,
): AnalystCallerContextSignature | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Partial<AnalystCallerContextSignature>;
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
