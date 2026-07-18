import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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

  it("fails closed unless every cutover evidence family is complete", () => {
    for (const key of [
      "allTerminal",
      "unresolved",
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
    ]) {
      expect(migration).toContain(key);
    }
    expect(migration).toContain("status = 'complete'");
    expect(migration).toContain("completed_at IS NOT NULL");
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
