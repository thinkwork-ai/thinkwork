/**
 * Analyst caller-context verifier tests (THINK-229 U2 / KTD3).
 *
 * Covers the trust matrix: valid contexts verify; tampered payloads,
 * wrong keys, expired contexts, foreign payload kinds (a signed sidecar
 * under the shared key!), and body-hash mismatches all reject with typed
 * reasons.
 */

import {
  createHash,
  generateKeyPairSync,
  sign as edSign,
  type KeyObject,
} from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ANALYST_CALLER_CONTEXT_KIND,
  canonicalizeCallerContextPayload,
  encodeAnalystCallerContextHeader,
  hashAnalystRequestBody,
  verifyAnalystCallerContextHeader,
  type AnalystCallerContextPayload,
  type AnalystCallerContextSignature,
} from "../analyst-caller-context.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const { privateKey: wrongKey } = generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }) as string;

const NOW = 1_800_000_000_000;
const BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "query", arguments: { sql: "SELECT 1" } },
});

/** Mirrors the API-side capability signer (envelope over canonical payload). */
function signPayload(
  payload: Record<string, unknown>,
  key: KeyObject = privateKey,
): AnalystCallerContextSignature {
  const canonical = canonicalizeCallerContextPayload(payload);
  return {
    version: 1,
    algorithm: "Ed25519",
    payloadHash: createHash("sha256").update(canonical).digest("hex"),
    signature: edSign(null, Buffer.from(canonical, "utf8"), key).toString(
      "hex",
    ),
    signed_by: "api-dispatch",
    signed_at: new Date(NOW).toISOString(),
  };
}

function sessionPayload(
  overrides: Partial<AnalystCallerContextPayload> = {},
): AnalystCallerContextPayload {
  return {
    kind: ANALYST_CALLER_CONTEXT_KIND,
    tenantId: "tenant-1",
    actor: "agent",
    agentId: "agent-1",
    policyClaims: {},
    iat: NOW,
    exp: NOW + 30 * 60 * 1000,
    ...overrides,
  };
}

function headerFor(
  payload: AnalystCallerContextPayload,
  key: KeyObject = privateKey,
): string {
  return encodeAnalystCallerContextHeader({
    payload,
    signature: signPayload(payload as unknown as Record<string, unknown>, key),
  });
}

function verify(headerValue: string, body = BODY, nowMs = NOW + 1000) {
  return verifyAnalystCallerContextHeader({
    headerValue,
    requestBody: body,
    publicKeyPem: PUBLIC_PEM,
    nowMs,
  });
}

describe("analyst caller context (THINK-229 U2)", () => {
  it("valid session context verifies and returns the payload", () => {
    const result = verify(headerFor(sessionPayload()));
    expect(result).toMatchObject({
      ok: true,
      payload: { tenantId: "tenant-1", actor: "agent", agentId: "agent-1" },
    });
  });

  it("valid request-bound system_refresh context verifies against the exact body", () => {
    const payload = sessionPayload({
      actor: "system_refresh",
      refreshId: "artifact-1",
      exp: NOW + 5 * 60 * 1000,
      bodyHash: hashAnalystRequestBody(BODY),
    });
    delete (payload as unknown as Record<string, unknown>).agentId;
    const result = verify(headerFor(payload));
    expect(result).toMatchObject({
      ok: true,
      payload: { actor: "system_refresh", refreshId: "artifact-1" },
    });
  });

  it("tampered payload rejects: any post-signature field change breaks the hash", () => {
    const payload = sessionPayload();
    const header = headerFor(payload);
    const decoded = JSON.parse(
      Buffer.from(header, "base64url").toString("utf8"),
    );
    decoded.payload.tenantId = "tenant-EVIL";
    const forged = Buffer.from(JSON.stringify(decoded), "utf8").toString(
      "base64url",
    );
    expect(verify(forged)).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("wrong signing key rejects", () => {
    expect(verify(headerFor(sessionPayload(), wrongKey))).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
  });

  it("expired context rejects", () => {
    const result = verify(
      headerFor(sessionPayload({ exp: NOW - 1 })),
      BODY,
      NOW,
    );
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("foreign payload kind rejects — a signed sidecar can never verify as a caller context (KTD3)", () => {
    // A validly-signed payload under the SAME key but without the
    // caller-context kind tag (the sidecar shape) must be rejected.
    const sidecarish = {
      capability: "connection",
      slug: "postgres-dev",
      signed_content_sha: "ab".repeat(32),
      tenantId: "tenant-1",
      actor: "agent",
      policyClaims: {},
      iat: NOW,
      exp: NOW + 60_000,
    };
    const header = encodeAnalystCallerContextHeader({
      payload: sidecarish as unknown as AnalystCallerContextPayload,
      signature: signPayload(sidecarish),
    });
    expect(verify(header)).toEqual({ ok: false, reason: "wrong_kind" });
  });

  it("context bound to a different request body rejects", () => {
    const payload = sessionPayload({
      actor: "system_refresh",
      bodyHash: hashAnalystRequestBody(BODY),
    });
    const result = verify(
      headerFor(payload),
      BODY.replace("SELECT 1", "SELECT 2"),
    );
    expect(result).toEqual({ ok: false, reason: "body_hash_mismatch" });
  });

  it("system_refresh without bodyHash rejects (request binding is mandatory)", () => {
    const result = verify(
      headerFor(sessionPayload({ actor: "system_refresh" })),
    );
    expect(result).toEqual({ ok: false, reason: "missing_body_hash" });
  });

  it("session context with an explicit bodyHash is enforced too", () => {
    const payload = sessionPayload({ bodyHash: hashAnalystRequestBody("x") });
    expect(verify(headerFor(payload))).toEqual({
      ok: false,
      reason: "body_hash_mismatch",
    });
  });

  it("policyClaims round-trip verbatim under the signature", () => {
    const claims = { budgets: { maxQueriesPerRun: 12 }, retain_sql: true };
    const result = verify(headerFor(sessionPayload({ policyClaims: claims })));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.policyClaims).toEqual(claims);
  });

  it("malformed inputs reject with typed reasons", () => {
    expect(verify("not-base64-json")).toEqual({
      ok: false,
      reason: "malformed_header",
    });
    const noSig = Buffer.from(
      JSON.stringify({ payload: sessionPayload() }),
      "utf8",
    ).toString("base64url");
    expect(verify(noSig)).toEqual({ ok: false, reason: "malformed_signature" });
  });
});
