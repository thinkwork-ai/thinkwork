/**
 * API-side caller-context minting (THINK-229 U2).
 *
 * Mints Ed25519-signed analyst caller contexts at the two trusted
 * bearer-resolution sites (MCP dispatch + headless canvas refresh).
 * The wire format, canonicalization, and verifier live in
 * `@thinkwork/lambda/analyst-caller-context` (the broker cannot import
 * @thinkwork/api); minting reuses the capability signer so key custody
 * and canonical bytes stay single-sourced (KTD3 — the in-payload `kind`
 * tag is the cryptographic domain separation; `signed_by: "api-dispatch"`
 * is transport provenance only).
 */

import {
  ANALYST_CALLER_CONTEXT_KIND,
  ANALYST_REQUEST_CONTEXT_TTL_MS,
  ANALYST_SESSION_CONTEXT_TTL_MS,
  encodeAnalystCallerContextHeader,
  hashAnalystRequestBody,
  type AnalystCallerActor,
  type AnalystCallerContextPayload,
} from "@thinkwork/lambda/analyst-caller-context";

import {
  resolveConfiguredCapabilitySigner,
  type CapabilitySigner,
} from "../capabilities/sidecar-signing.js";

export {
  ANALYST_CALLER_CONTEXT_HEADER,
  hashAnalystRequestBody,
} from "@thinkwork/lambda/analyst-caller-context";

export interface MintAnalystCallerContextInput {
  actor: AnalystCallerActor;
  tenantId: string;
  agentId?: string;
  threadId?: string;
  refreshId?: string;
  /** Sidecar-derived claims (U3/U4); defaults to {} during phase-in. */
  policyClaims?: Record<string, unknown>;
  /** Required for system_refresh: sha256 hex of the exact JSON-RPC body. */
  bodyHash?: string;
  /** Override for tests; defaults per actor mode. */
  ttlMs?: number;
  nowMs?: number;
  /** Injected signer for tests; defaults to the platform capability signer. */
  signer?: CapabilitySigner | null;
}

/**
 * Returns the encoded header value, or null when platform signing is
 * unavailable (callers stay on the legacy bearer during phase-in — the
 * broker accepts both until retirement, R5).
 */
export async function mintAnalystCallerContextHeader(
  input: MintAnalystCallerContextInput,
): Promise<string | null> {
  if (input.actor === "system_refresh" && !input.bodyHash) {
    throw new Error(
      "system_refresh caller contexts must be request-bound: bodyHash is required",
    );
  }
  const signer =
    input.signer !== undefined
      ? input.signer
      : await resolveConfiguredCapabilitySigner();
  if (!signer) return null;

  const now = input.nowMs ?? Date.now();
  const ttl =
    input.ttlMs ??
    (input.actor === "system_refresh"
      ? ANALYST_REQUEST_CONTEXT_TTL_MS
      : ANALYST_SESSION_CONTEXT_TTL_MS);

  const payload: AnalystCallerContextPayload = {
    kind: ANALYST_CALLER_CONTEXT_KIND,
    tenantId: input.tenantId,
    actor: input.actor,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.refreshId ? { refreshId: input.refreshId } : {}),
    policyClaims: input.policyClaims ?? {},
    iat: now,
    exp: now + ttl,
    ...(input.bodyHash ? { bodyHash: input.bodyHash } : {}),
  };

  const signature = signer.signPayload(
    payload as unknown as Record<string, unknown>,
    { signedBy: "api-dispatch" },
  );
  return encodeAnalystCallerContextHeader({ payload, signature });
}

/**
 * The analyst query broker's fixed route (terraform
 * lambda-api/handlers.tf "POST /mcp/analyst"). Caller contexts are a
 * broker credential — they must NEVER ride to any other MCP server, so
 * both mint sites gate on this predicate.
 */
export function isAnalystBrokerUrl(url: string): boolean {
  try {
    return new URL(url).pathname === "/mcp/analyst";
  } catch {
    return false;
  }
}
