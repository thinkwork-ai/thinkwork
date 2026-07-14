/**
 * API-side caller-context mint tests (THINK-229 U2).
 *
 * The load-bearing assertion is CROSS-PACKAGE: mint through the real
 * capability signer (packages/api) and verify with the broker's verifier
 * (packages/lambda) — canonicalization can never drift silently between
 * the two.
 */

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  canonicalizeCallerContextPayload,
  hashAnalystRequestBody,
  verifyAnalystCallerContextHeader,
} from "@thinkwork/lambda/analyst-caller-context";

import {
  canonicalizePayload,
  capabilitySignerFromKey,
} from "../capabilities/sidecar-signing.js";
import {
  analystBrokerSourceSlug,
  isAnalystBrokerUrl,
  matchAnalystBrokerUrl,
  mintAnalystCallerContextHeader,
  sourceClaimsFromRuntimeMetadata,
} from "./caller-context.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }) as string;
const signer = capabilitySignerFromKey(privateKey);

describe("analyst caller-context minting (THINK-229 U2)", () => {
  it("cross-package roundtrip: API-minted context verifies under the broker verifier", async () => {
    const header = await mintAnalystCallerContextHeader({
      actor: "agent",
      tenantId: "tenant-1",
      agentId: "agent-1",
      policyClaims: { budgets: { maxQueriesPerRun: 9 } },
      signer,
      nowMs: 1_800_000_000_000,
    });
    expect(header).toBeTruthy();
    const result = verifyAnalystCallerContextHeader({
      headerValue: header!,
      requestBody: "irrelevant for session contexts",
      publicKeyPem: PUBLIC_PEM,
      nowMs: 1_800_000_000_000 + 1000,
    });
    expect(result).toMatchObject({
      ok: true,
      payload: {
        tenantId: "tenant-1",
        actor: "agent",
        agentId: "agent-1",
        policyClaims: { budgets: { maxQueriesPerRun: 9 } },
      },
    });
  });

  it("request-bound refresh context: bodyHash pins the exact body", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
    });
    const header = await mintAnalystCallerContextHeader({
      actor: "system_refresh",
      tenantId: "tenant-1",
      refreshId: "artifact-9",
      bodyHash: hashAnalystRequestBody(body),
      signer,
    });
    const ok = verifyAnalystCallerContextHeader({
      headerValue: header!,
      requestBody: body,
      publicKeyPem: PUBLIC_PEM,
      nowMs: Date.now(),
    });
    expect(ok.ok).toBe(true);
    const wrongBody = verifyAnalystCallerContextHeader({
      headerValue: header!,
      requestBody: body + " ",
      publicKeyPem: PUBLIC_PEM,
      nowMs: Date.now(),
    });
    expect(wrongBody).toEqual({ ok: false, reason: "body_hash_mismatch" });
  });

  it("system_refresh without bodyHash throws at mint time", async () => {
    await expect(
      mintAnalystCallerContextHeader({
        actor: "system_refresh",
        tenantId: "tenant-1",
        signer,
      }),
    ).rejects.toThrow(/bodyHash is required/);
  });

  it("signing unavailable → null (caller stays on the legacy bearer)", async () => {
    await expect(
      mintAnalystCallerContextHeader({
        actor: "agent",
        tenantId: "tenant-1",
        signer: null,
      }),
    ).resolves.toBeNull();
  });

  it("canonicalization parity: sidecar-signing and the broker verifier produce identical bytes", () => {
    const fixture = {
      z: [3, { b: 2, a: 1 }],
      a: { nested: { y: undefined, x: "1" } },
      kind: "analyst-caller-context",
      n: null,
    };
    expect(canonicalizePayload(fixture)).toBe(
      canonicalizeCallerContextPayload(fixture),
    );
  });

  it("expiry modes: session 30 min, request-bound 5 min", async () => {
    const now = 1_800_000_000_000;
    const session = await mintAnalystCallerContextHeader({
      actor: "agent",
      tenantId: "t",
      signer,
      nowMs: now,
    });
    const sessionPayload = JSON.parse(
      Buffer.from(session!, "base64url").toString("utf8"),
    ).payload;
    expect(sessionPayload.exp - sessionPayload.iat).toBe(30 * 60 * 1000);

    const bound = await mintAnalystCallerContextHeader({
      actor: "system_refresh",
      tenantId: "t",
      bodyHash: hashAnalystRequestBody("{}"),
      signer,
      nowMs: now,
    });
    const boundPayload = JSON.parse(
      Buffer.from(bound!, "base64url").toString("utf8"),
    ).payload;
    expect(boundPayload.exp - boundPayload.iat).toBe(5 * 60 * 1000);
  });

  it("isAnalystBrokerUrl matches the builtin AND sourced routes (THINK-239)", () => {
    expect(
      isAnalystBrokerUrl(
        "https://ho7oyksms0.execute-api.us-east-1.amazonaws.com/mcp/analyst",
      ),
    ).toBe(true);
    // THINK-239: a sourced route is also a broker route.
    expect(isAnalystBrokerUrl("https://example.com/mcp/analyst/sales-pg")).toBe(
      true,
    );
    expect(isAnalystBrokerUrl("https://example.com/mcp/other")).toBe(false);
    // A second path segment is not a valid single-slug source.
    expect(isAnalystBrokerUrl("https://example.com/mcp/analyst/sales/pg")).toBe(
      false,
    );
    expect(isAnalystBrokerUrl("not a url")).toBe(false);
  });

  it("matchAnalystBrokerUrl returns the source slug (THINK-239)", () => {
    expect(matchAnalystBrokerUrl("https://x.test/mcp/analyst")).toEqual({
      isBroker: true,
      sourceSlug: null,
    });
    expect(
      matchAnalystBrokerUrl("https://x.test/mcp/analyst/sales-pg"),
    ).toEqual({ isBroker: true, sourceSlug: "sales-pg" });
    expect(matchAnalystBrokerUrl("https://x.test/mcp/other")).toEqual({
      isBroker: false,
      sourceSlug: null,
    });
    expect(analystBrokerSourceSlug("https://x.test/mcp/analyst/sales-pg")).toBe(
      "sales-pg",
    );
    expect(analystBrokerSourceSlug("https://x.test/mcp/analyst")).toBeNull();
  });

  it("sourceClaimsFromRuntimeMetadata reconstructs claims minus slug (THINK-239)", () => {
    const runtimeMetadata = {
      analyst_probe: { status: "ok", checkedAt: "2026-07-09T00:00:00Z" },
      analyst_source: {
        host: "sales.example.rds.amazonaws.com",
        port: 5432,
        database: "sales",
        dbUser: "analyst_ro",
        tls: "verify-full",
        credentialSecretArn:
          "thinkwork/dev/analyst/t1/sales-pg-reader-credential",
        tenantScoped: true,
      },
    };
    expect(
      sourceClaimsFromRuntimeMetadata("sales-pg", runtimeMetadata),
    ).toEqual({
      slug: "sales-pg",
      host: "sales.example.rds.amazonaws.com",
      port: 5432,
      database: "sales",
      dbUser: "analyst_ro",
      tls: "verify-full",
      credentialSecretArn:
        "thinkwork/dev/analyst/t1/sales-pg-reader-credential",
      tenantScoped: true,
      // THINK-283: legacy rows without a stored schema always mint public.
      schema: "public",
    });
    // Builtin rows (no analyst_source) → null.
    expect(sourceClaimsFromRuntimeMetadata("sales-pg", {})).toBeNull();
    // Malformed block → null.
    expect(
      sourceClaimsFromRuntimeMetadata("sales-pg", {
        analyst_source: { host: "h" },
      }),
    ).toBeNull();
  });

  it("THINK-283: stored schema and generation ride into minted claims", () => {
    const base = {
      host: "wh.example.rds.amazonaws.com",
      port: 5432,
      database: "thinkwork_warehouse",
      dbUser: "analyst_ro",
      tls: "verify-full",
      credentialSecretArn:
        "thinkwork/dev/analyst/t1/warehouse-reader-credential",
      tenantScoped: true,
    };
    expect(
      sourceClaimsFromRuntimeMetadata("warehouse", {
        analyst_source: {
          ...base,
          schema: "raw_jde",
          sourceGeneration: "gen-01HZX",
        },
      }),
    ).toMatchObject({ schema: "raw_jde", sourceGeneration: "gen-01HZX" });
    // Legacy row with no generation mints no generation (broker fallback).
    const legacy = sourceClaimsFromRuntimeMetadata("warehouse", {
      analyst_source: base,
    });
    expect(legacy?.schema).toBe("public");
    expect(legacy?.sourceGeneration).toBeUndefined();
    // Present-but-malformed values are a corrupt row, not a default.
    expect(
      sourceClaimsFromRuntimeMetadata("warehouse", {
        analyst_source: { ...base, schema: "" },
      }),
    ).toBeNull();
    expect(
      sourceClaimsFromRuntimeMetadata("warehouse", {
        analyst_source: { ...base, sourceGeneration: 42 },
      }),
    ).toBeNull();
  });

  it("mints sourceClaims into the context, verifiable cross-package (THINK-239)", async () => {
    const sourceClaims = {
      slug: "sales-pg",
      host: "sales.example.rds.amazonaws.com",
      port: 5432,
      database: "sales",
      dbUser: "analyst_ro",
      tls: "verify-full" as const,
      credentialSecretArn:
        "thinkwork/dev/analyst/t1/sales-pg-reader-credential",
      tenantScoped: true,
    };
    const header = await mintAnalystCallerContextHeader({
      actor: "agent",
      tenantId: "tenant-1",
      agentId: "agent-1",
      sourceClaims,
      signer,
    });
    const result = verifyAnalystCallerContextHeader({
      headerValue: header!,
      requestBody: "irrelevant",
      publicKeyPem: PUBLIC_PEM,
      nowMs: Date.now(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.sourceClaims).toEqual(sourceClaims);
  });

  it("builtin mint attaches NO sourceClaims (back-compat)", async () => {
    const header = await mintAnalystCallerContextHeader({
      actor: "agent",
      tenantId: "tenant-1",
      signer,
    });
    const decoded = JSON.parse(
      Buffer.from(header!, "base64url").toString("utf8"),
    );
    expect(decoded.payload.sourceClaims).toBeUndefined();
  });
});
