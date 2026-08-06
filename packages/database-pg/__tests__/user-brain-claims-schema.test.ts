/**
 * user_brain_claims schema tests (THINK-625).
 *
 * The manifest publisher reads these columns verbatim, so the shape is a
 * cross-repo contract in disguise: NULL-vs-empty `tool_allowlist` and the
 * (tenant, user) uniqueness are the two properties whose regression would
 * silently change what a signed-in human can see in the Brain.
 */
import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { userBrainClaims } from "../src/schema/user-brain-claims";
import { tenantSettings } from "../src/schema/core";
import {
  TENANT_POLICY_EVENT_TYPES,
  tenantPolicyEvents,
} from "../src/schema/tenant-policy-events";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATION = readFileSync(
  resolve(__dirname, "../drizzle/0284_user_brain_claims.sql"),
  "utf8",
);

describe("user_brain_claims schema", () => {
  it("defines the per-(tenant, user) claims table", () => {
    expect(getTableName(userBrainClaims)).toBe("user_brain_claims");
    const columns = getTableColumns(userBrainClaims);

    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.user_id.notNull).toBe(true);
    expect(columns.security_groups.notNull).toBe(true);
    expect(columns.kb_collections.notNull).toBe(true);
    expect(columns.kb_bundles.notNull).toBe(true);
    expect(columns.is_operator.notNull).toBe(true);
    expect(columns.kb_trace.notNull).toBe(true);
    expect(columns.enabled.notNull).toBe(true);
  });

  it("defaults grants to least privilege and the row to enabled", () => {
    const columns = getTableColumns(userBrainClaims);
    expect(columns.is_operator.default).toBe(false);
    expect(columns.kb_trace.default).toBe(false);
    expect(columns.enabled.default).toBe(true);
    expect(MIGRATION).toContain(
      "security_groups text[] NOT NULL DEFAULT ARRAY[]::text[]",
    );
    expect(MIGRATION).toContain(
      "kb_collections text[] NOT NULL DEFAULT ARRAY[]::text[]",
    );
    expect(MIGRATION).toContain("enabled boolean NOT NULL DEFAULT true");
  });

  it("keeps tool_allowlist nullable — NULL (surface default) is not {} (no tools)", () => {
    const columns = getTableColumns(userBrainClaims);
    expect(columns.tool_allowlist.notNull).toBe(false);
    expect(columns.tool_allowlist.hasDefault).toBe(false);
    // No DEFAULT in the DDL either: an unset allowlist must stay NULL.
    expect(MIGRATION).toContain("tool_allowlist text[],");
    expect(MIGRATION).not.toContain("tool_allowlist text[] NOT NULL");
  });

  it("allows exactly one claims row per (tenant, user)", () => {
    const config = getTableConfig(userBrainClaims);
    const unique = config.indexes.find(
      (index) => index.config.name === "uq_user_brain_claims_tenant_user",
    );
    expect(unique?.config.unique).toBe(true);
    expect(
      unique?.config.columns.map((c) => (c as { name: string }).name),
    ).toEqual(["tenant_id", "user_id"]);
    expect(MIGRATION).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_brain_claims_tenant_user",
    );
  });

  it("indexes the tenant for the whole-manifest read", () => {
    const config = getTableConfig(userBrainClaims);
    expect(
      config.indexes.some(
        (index) => index.config.name === "idx_user_brain_claims_tenant",
      ),
    ).toBe(true);
  });

  it("declares drift markers for every object the hand-rolled file creates", () => {
    for (const marker of [
      "-- creates: public.user_brain_claims",
      "-- creates: public.uq_user_brain_claims_tenant_user",
      "-- creates: public.idx_user_brain_claims_tenant",
      "-- creates-column: public.tenant_settings.brain_user_claims_enabled",
      "-- creates-constraint: public.tenant_policy_events.tenant_policy_events_event_type_allowed_v2",
    ]) {
      expect(MIGRATION).toContain(marker);
    }
  });
});

describe("tenant_settings.brain_user_claims_enabled", () => {
  it("is a non-null boolean defaulting to false — publish is opt-in", () => {
    const columns = getTableColumns(tenantSettings);
    expect(columns.brain_user_claims_enabled.notNull).toBe(true);
    expect(columns.brain_user_claims_enabled.default).toBe(false);
    expect(MIGRATION).toContain(
      "ADD COLUMN IF NOT EXISTS brain_user_claims_enabled boolean NOT NULL DEFAULT false",
    );
  });
});

describe("tenant_policy_events event types", () => {
  it("accepts user_brain_claims as an audited policy event", () => {
    expect(TENANT_POLICY_EVENT_TYPES).toContain("user_brain_claims");
  });

  it("widens the CHECK under a fresh constraint name so drift is detectable", () => {
    const config = getTableConfig(tenantPolicyEvents);
    const names = config.checks.map((c) => c.name);
    expect(names).toContain("tenant_policy_events_event_type_allowed_v2");
    expect(names).not.toContain("tenant_policy_events_event_type_allowed");
    expect(MIGRATION).toContain(
      "DROP CONSTRAINT IF EXISTS tenant_policy_events_event_type_allowed;",
    );
    expect(MIGRATION).toContain(
      "CHECK (event_type IN ('sandbox_enabled','compliance_tier','user_brain_claims'))",
    );
  });
});
