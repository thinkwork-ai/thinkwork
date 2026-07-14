/**
 * Action-time analyst source authorization tests (THINK-283 U7).
 *
 * Injected client — no DB. Covers the authorization matrix (current row
 * required; approved+enabled; probe/refresh gates; generation binding with
 * the legacy fallback), the fail-closed control-outage path, and the
 * transaction/GUC hygiene that keeps tenant scope from leaking across
 * sequential invocations on a reused platform connection.
 */

import { describe, expect, it, vi } from "vitest";

import {
  authorizeAnalystSourceCall,
  SOURCE_PROBE_STALE_AFTER_MS,
  type AuthzPgClient,
} from "../analyst-source-authorization.js";
import type { AnalystSourceClaims } from "../analyst-caller-context.js";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const TENANT = "11111111-1111-7111-8111-111111111111";

function claims(over: Partial<AnalystSourceClaims> = {}): AnalystSourceClaims {
  return {
    slug: "warehouse",
    host: "wh.example.rds.amazonaws.com",
    port: 5432,
    database: "thinkwork_warehouse",
    dbUser: "warehouse_reader",
    tls: "required",
    credentialSecretArn: "arn:secret:warehouse",
    tenantScoped: true,
    schema: "raw_jde",
    sourceGeneration: "gen-1",
    ...over,
  };
}

function sourceMeta(over: Record<string, unknown> = {}) {
  return {
    host: "wh.example.rds.amazonaws.com",
    port: 5432,
    database: "thinkwork_warehouse",
    dbUser: "warehouse_reader",
    tls: "required",
    credentialSecretArn: "arn:secret:warehouse",
    tenantScoped: true,
    schema: "raw_jde",
    kind: "internal",
    sourceGeneration: "gen-1",
    ...over,
  };
}

function row(over: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANT,
    slug: "warehouse",
    enabled: true,
    status: "approved",
    runtime_metadata: {
      analyst_source: sourceMeta(),
      analyst_probe: {
        status: "ok",
        checkedAt: new Date(NOW - 60_000).toISOString(),
      },
    },
    ...over,
  };
}

function fakeClient(
  rows: Record<string, unknown>[],
  opts: { throwOnSelect?: boolean } = {},
) {
  const statements: { text: string; params?: unknown[] }[] = [];
  const client: AuthzPgClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      statements.push({ text, params });
      if (text.includes("FROM tenant_mcp_servers")) {
        if (opts.throwOnSelect) throw new Error("connection reset");
        return { rows };
      }
      return { rows: [] };
    }),
  };
  return { client, statements };
}

function authorize(
  client: AuthzPgClient,
  claimsOver: Partial<AnalystSourceClaims> = {},
) {
  return authorizeAnalystSourceCall({
    tenantId: TENANT,
    slug: "warehouse",
    claims: claims(claimsOver),
    client,
    nowMs: NOW,
  });
}

describe("authorizeAnalystSourceCall (THINK-283 U7)", () => {
  it("happy path: approved/enabled row, no gates, matching generation → ok", async () => {
    const { client, statements } = fakeClient([row()]);
    expect(await authorize(client)).toEqual({ ok: true });

    // Transaction + GUC hygiene: BEGIN → transaction-LOCAL set_config →
    // tenant-scoped select → COMMIT. Nothing can outlive the transaction.
    const texts = statements.map((s) => s.text);
    expect(texts[0]).toBe("BEGIN");
    expect(texts[1]).toContain(
      "set_config('thinkwork.analyst_tenant', $1, true)",
    );
    expect(statements[1]!.params).toEqual([TENANT]);
    expect(texts[2]).toContain("FROM tenant_mcp_servers");
    expect(statements[2]!.params).toEqual([TENANT, "warehouse"]);
    expect(texts[3]).toBe("COMMIT");
  });

  it("unknown row / RLS tenant mismatch → source_not_found (fail closed)", async () => {
    const { client } = fakeClient([]);
    expect(await authorize(client)).toEqual({
      ok: false,
      reason: "source_not_found",
    });
  });

  it("disabled or non-approved rows deny", async () => {
    const disabled = fakeClient([row({ enabled: false })]);
    expect(await authorize(disabled.client)).toEqual({
      ok: false,
      reason: "source_disabled",
    });
    const pending = fakeClient([row({ status: "pending" })]);
    expect(await authorize(pending.client)).toEqual({
      ok: false,
      reason: "source_disabled",
    });
  });

  it("failed or stale probe verdicts deny (probe_gate)", async () => {
    const failed = fakeClient([
      row({
        runtime_metadata: {
          analyst_source: sourceMeta(),
          analyst_probe: { status: "fail", checkedAt: "x" },
        },
      }),
    ]);
    expect(await authorize(failed.client)).toEqual({
      ok: false,
      reason: "probe_gate",
    });
    const stale = fakeClient([
      row({
        runtime_metadata: {
          analyst_source: sourceMeta(),
          analyst_probe: {
            status: "ok",
            checkedAt: new Date(
              NOW - SOURCE_PROBE_STALE_AFTER_MS - 1000,
            ).toISOString(),
          },
        },
      }),
    ]);
    expect(await authorize(stale.client)).toEqual({
      ok: false,
      reason: "probe_gate",
    });
    // Pre-first-probe rows (no verdict) are NOT probe-gated.
    const unprobed = fakeClient([
      row({ runtime_metadata: { analyst_source: sourceMeta() } }),
    ]);
    expect(await authorize(unprobed.client)).toEqual({ ok: true });
  });

  it("action-time security: running/failed/malformed refresh state denies (refresh_gate)", async () => {
    for (const refresh of [
      { status: "running", attemptId: "a1" },
      { status: "failed", detail: "artifacts step failed" },
      { status: "??" },
    ]) {
      const { client } = fakeClient([
        row({
          runtime_metadata: {
            analyst_source: sourceMeta(),
            analyst_refresh: refresh,
          },
        }),
      ]);
      expect(await authorize(client)).toEqual({
        ok: false,
        reason: "refresh_gate",
      });
    }
    // A completed refresh serves.
    const okRefresh = fakeClient([
      row({
        runtime_metadata: {
          analyst_source: sourceMeta(),
          analyst_refresh: { status: "ok", attemptId: "a1" },
        },
      }),
    ]);
    expect(await authorize(okRefresh.client)).toEqual({ ok: true });
  });

  it("generation binding: stale claims are rejected after the row's generation advances", async () => {
    const { client } = fakeClient([
      row({
        runtime_metadata: {
          analyst_source: sourceMeta({ sourceGeneration: "gen-2" }),
        },
      }),
    ]);
    // Claim minted before the refresh (gen-1) is rejected after success.
    expect(await authorize(client, { sourceGeneration: "gen-1" })).toEqual({
      ok: false,
      reason: "generation_mismatch",
    });
  });

  it("compatibility: legacy claim + legacy row serve; the fallback ends once the row has a generation", async () => {
    const legacyRow = row({
      runtime_metadata: {
        analyst_source: sourceMeta({ sourceGeneration: undefined }),
      },
    });
    const legacy = fakeClient([legacyRow]);
    expect(
      await authorize(legacy.client, { sourceGeneration: undefined }),
    ).toEqual({ ok: true });

    // Same legacy claim against a row that NOW has a generation → denied.
    const upgraded = fakeClient([row()]);
    expect(
      await authorize(upgraded.client, { sourceGeneration: undefined }),
    ).toEqual({ ok: false, reason: "generation_mismatch" });

    // A generation-bearing claim against a legacy row is inconsistent → deny.
    const inconsistent = fakeClient([legacyRow]);
    expect(
      await authorize(inconsistent.client, { sourceGeneration: "gen-9" }),
    ).toEqual({ ok: false, reason: "generation_mismatch" });
  });

  it("malformed metadata denies (malformed_metadata)", async () => {
    const { client } = fakeClient([row({ runtime_metadata: null })]);
    expect(await authorize(client)).toEqual({
      ok: false,
      reason: "malformed_metadata",
    });
    const noSource = fakeClient([row({ runtime_metadata: {} })]);
    expect(await authorize(noSource.client)).toEqual({
      ok: false,
      reason: "malformed_metadata",
    });
  });

  it("control-database outage denies and ROLLS BACK — GUC scope cannot leak after a throw", async () => {
    const { client, statements } = fakeClient([], { throwOnSelect: true });
    expect(await authorize(client)).toEqual({
      ok: false,
      reason: "authz_unavailable",
    });
    const texts = statements.map((s) => s.text);
    expect(texts[0]).toBe("BEGIN");
    expect(texts[texts.length - 1]).toBe("ROLLBACK");
    expect(texts).not.toContain("COMMIT");
  });
});
