import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import * as auth from "../src/schema/auth";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0263_drop_workos_auth_runtime.sql"),
  "utf8",
);

describe("migration 0263 — drop WorkOS auth runtime", () => {
  it("declares explicit drift markers for both retired tables", () => {
    expect(migration).toContain("-- drops: public.workos_auth_bridges");
    expect(migration).toContain("-- drops: public.workos_auth_sessions");
  });

  it("keeps retired WorkOS tables out of the canonical Drizzle schema", () => {
    expect(auth).not.toHaveProperty("workosAuthBridges");
    expect(auth).not.toHaveProperty("workosAuthSessions");
  });

  it("keeps canonical lifecycle defaults and constraints at the retired boundary", () => {
    const resources = getTableConfig(auth.authProviderResources);
    const routes = getTableConfig(auth.authRouteClients);
    expect(auth.authProviderResources.lifecycle_state.default).toBe("native");
    const dialect = new PgDialect();
    for (const check of [...resources.checks, ...routes.checks].filter(
      (candidate) => candidate.name.includes("lifecycle"),
    )) {
      const rendered = dialect.sqlToQuery(check.value).sql;
      expect(rendered).not.toContain("coexistence");
      expect(rendered).toContain("native");
      expect(rendered).toContain("denied");
    }
  });

  it("fails closed unless every cutover evidence family is complete", () => {
    for (const key of [
      "allTerminal",
      "unresolved",
      "signoutExpected",
      "signoutAttempts",
      "signoutFailures",
      "compatibilityFallbackReads",
      "workosStartsEnabled",
      "legacyClientsEnabled",
      "legacyAudiencesAccepted",
      "drainCompleted",
      "legacyRouteTraffic",
      "workosTableReads",
      "workosTableWrites",
      "activeLegacySubscriptions",
      "soakStartedAt",
      "requiredSoakSeconds",
      "baselineDatabaseStatsResetAt",
      "databaseStatsResetAt",
      "deploymentRevision",
    ]) {
      expect(migration).toContain(key);
    }
    expect(migration).toContain("cutover.status <> 'complete'");
    expect(migration).toContain("cutover.completed_at IS NULL");
    expect(migration).toContain("requiredSoakSeconds')::bigint, 0) < 86400");
    expect(migration).toMatch(
      /signoutAttempts'[\s\S]*<>[\s\S]*signoutExpected'/,
    );
    expect(migration).toMatch(
      /baselineDatabaseStatsResetAt'[\s\S]*<> cutover\.drain_evidence->>'databaseStatsResetAt'/,
    );
  });

  it("requires the newest run for the exact requested stage to be complete", () => {
    expect(migration).toContain(
      "set_config('thinkwork.auth_retirement_stage', :'stage', true)",
    );
    expect(migration).toContain(
      "WHERE stage = current_setting('thinkwork.auth_retirement_stage')",
    );
    expect(migration).toContain("ORDER BY created_at DESC, id DESC");
    expect(migration.indexOf("ORDER BY created_at DESC, id DESC")).toBeLessThan(
      migration.indexOf("cutover.status <> 'complete'"),
    );
    expect(migration).not.toContain("WHERE status = 'complete'");
  });

  it("requires signed evidence bound to the run, stage, revision, and validity window", () => {
    for (const value of [
      "thinkwork.auth-cutover-evidence.v1",
      "verify-native-auth-cutover",
      "deploymentRevision",
      "payloadHash",
      "signature",
      "observedAt",
      "expiresAt",
    ]) {
      expect(migration).toContain(value);
    }
    expect(migration).toContain("<> cutover.id::text");
    expect(migration).toContain("cutover.completed_at <");
    expect(migration).toContain("cutover.completed_at >");
  });

  it("does not require fictional cutover evidence on a clean installation", () => {
    expect(migration).toContain(
      "No WorkOS auth data exists — empty historical tables may be retired without cutover evidence",
    );
    expect(migration).toContain(
      "SELECT EXISTS (SELECT 1 FROM public.workos_auth_bridges)",
    );
    expect(migration).toContain(
      "SELECT EXISTS (SELECT 1 FROM public.workos_auth_sessions)",
    );
  });

  it("rejects live enrollment, bridge, or session state before mutation", () => {
    expect(migration).toContain("enrollment.status = 'pending'");
    expect(migration).toContain("active WorkOS session(s)");
    expect(migration).toContain("live WorkOS bridge(s)");
    expect(migration.indexOf("live WorkOS bridge(s)")).toBeLessThan(
      migration.indexOf("DROP TABLE IF EXISTS public.workos_auth_bridges"),
    );
  });

  it("uses one advisory-locked transaction and never cascades", () => {
    expect(migration).toContain("\\set ON_ERROR_STOP on");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration.trim().endsWith("COMMIT;")).toBe(true);
    expect(migration).not.toMatch(/\bCASCADE\b/i);
  });

  it("narrows supported plugin and auth lifecycle constraints", () => {
    expect(migration).toContain(
      "component_type IN ('mcp-server', 'skills', 'infrastructure', 'ui-surface')",
    );
    expect(migration).toContain("lifecycle_state IN ('native', 'denied')");
    expect(migration).not.toContain("IN ('coexistence', 'native', 'denied')");
  });
});
