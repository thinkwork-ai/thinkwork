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
  type AnalystSourceClaims,
} from "@thinkwork/lambda/analyst-caller-context";

export type { AnalystSourceClaims } from "@thinkwork/lambda/analyst-caller-context";

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
  /**
   * External source description (THINK-239). Present only when minting for a
   * sourced broker route (`/mcp/analyst/{sourceSlug}`); the broker binds the
   * path slug to `sourceClaims.slug`. Absent = builtin source.
   */
  sourceClaims?: AnalystSourceClaims;
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
    ...(input.sourceClaims ? { sourceClaims: input.sourceClaims } : {}),
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
 * The analyst query broker's routes (terraform lambda-api/handlers.tf):
 * the builtin `POST /mcp/analyst` and the THINK-239 sourced
 * `POST /mcp/analyst/{sourceSlug}`. Caller contexts are a broker credential —
 * they must NEVER ride to any other MCP server, so both mint sites gate on
 * this match.
 *
 * Returns `{ isBroker, sourceSlug }`: `sourceSlug` is null for the builtin
 * route and the `<slug>` for a sourced route. The slug shape mirrors the
 * registration validator (`^[a-z0-9][a-z0-9-]{1,38}$`) so a stray extra path
 * segment never reads as a source.
 */
export function matchAnalystBrokerUrl(url: string): {
  isBroker: boolean;
  sourceSlug: string | null;
} {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    if (pathname === "/mcp/analyst")
      return { isBroker: true, sourceSlug: null };
    const match = pathname.match(/^\/mcp\/analyst\/([a-z0-9][a-z0-9-]{1,38})$/);
    if (match) return { isBroker: true, sourceSlug: match[1]! };
    return { isBroker: false, sourceSlug: null };
  } catch {
    return { isBroker: false, sourceSlug: null };
  }
}

/** True for either the builtin or a sourced analyst broker route. */
export function isAnalystBrokerUrl(url: string): boolean {
  return matchAnalystBrokerUrl(url).isBroker;
}

/** The source slug carried by an analyst broker URL, or null (builtin/none). */
export function analystBrokerSourceSlug(url: string): string | null {
  return matchAnalystBrokerUrl(url).sourceSlug;
}

/**
 * Reconstruct signed {@link AnalystSourceClaims} from a registry row's
 * `runtime_metadata.analyst_source` block plus its slug (THINK-239). The
 * stored block is the sourceClaims shape MINUS the slug; returns null when the
 * block is absent or malformed (builtin rows, or a corrupt row).
 */
export function sourceClaimsFromRuntimeMetadata(
  slug: string,
  runtimeMetadata: unknown,
): AnalystSourceClaims | null {
  if (!runtimeMetadata || typeof runtimeMetadata !== "object") return null;
  const raw = (runtimeMetadata as Record<string, unknown>).analyst_source;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const tls = m.tls;
  if (
    typeof m.host !== "string" ||
    typeof m.port !== "number" ||
    typeof m.database !== "string" ||
    typeof m.dbUser !== "string" ||
    (tls !== "verify-full" && tls !== "required") ||
    typeof m.credentialSecretArn !== "string"
  ) {
    return null;
  }
  return {
    slug,
    host: m.host,
    port: m.port,
    database: m.database,
    dbUser: m.dbUser,
    tls,
    credentialSecretArn: m.credentialSecretArn,
    tenantScoped: m.tenantScoped === true,
  };
}
