import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as auth from "../src/schema/auth";
import * as schema from "../src/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0261_native_auth_control_plane.sql"),
  "utf8",
);

describe("migration 0261 — native auth control plane", () => {
  it("exports provider-neutral auth tables independently of plugins", () => {
    for (const [name, table] of [
      ["authProviderResources", auth.authProviderResources],
      ["tenantAuthProviderReferences", auth.tenantAuthProviderReferences],
      ["tenantAuthPolicies", auth.tenantAuthPolicies],
      ["tenantAuthHosts", auth.tenantAuthHosts],
      ["authRouteClients", auth.authRouteClients],
      ["userAuthIdentities", auth.userAuthIdentities],
      ["authIdentityEnrollments", auth.authIdentityEnrollments],
      ["authReconciliationSets", auth.authReconciliationSets],
      ["authCutoverRuns", auth.authCutoverRuns],
      ["authIdentityProofs", auth.authIdentityProofs],
    ] as const) {
      expect(schema[name]).toBe(table);
    }
  });

  it("makes legacy plugin ownership optional and non-cascading", () => {
    const columns = getTableColumns(auth.tenantAuthProviderReferences);
    expect(columns.plugin_install_id.notNull).toBe(false);
    expect(
      getTableConfig(auth.tenantAuthProviderReferences).foreignKeys.map(
        (foreignKey) => foreignKey.onDelete,
      ),
    ).not.toContain("cascade");
    expect(migration).toContain("ON DELETE SET NULL");
    expect(migration).toContain(
      "uq_tenant_auth_provider_references_tenant_resource",
    );
    expect(migration).not.toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_auth_provider_references_install_resource/,
    );
  });

  it("enforces stable Cognito and provider identity uniqueness", () => {
    expect(getTableName(auth.userAuthIdentities)).toBe("user_auth_identities");
    const config = getTableConfig(auth.userAuthIdentities);
    const indexes = config.indexes.map((index) => index.config.name);
    expect(indexes).toContain("uq_user_auth_identities_cognito_sub");
    expect(indexes).toContain("uq_user_auth_identities_provider_subject");
    expect(indexes).toContain("idx_user_auth_identities_user_status");
    expect(config.foreignKeys.map((foreignKey) => foreignKey.onDelete)).toEqual(
      expect.arrayContaining(["restrict", "restrict", "restrict"]),
    );
  });

  it("stores only enrollment hashes and durable cutover evidence", () => {
    const enrollment = getTableColumns(auth.authIdentityEnrollments);
    expect(enrollment.nonce_digest.notNull).toBe(true);
    expect(enrollment.recipient_challenge_digest.notNull).toBe(true);
    expect(enrollment).not.toHaveProperty("nonce");
    expect(enrollment).not.toHaveProperty("recipient_challenge");

    const cutover = getTableColumns(auth.authCutoverRuns);
    expect(cutover.inventory_fingerprint.notNull).toBe(true);
    expect(cutover.terminal_dispositions.notNull).toBe(true);
    expect(cutover.client_shutdown_evidence.notNull).toBe(true);
    expect(cutover.drain_evidence.notNull).toBe(true);
  });

  it("declares drift markers for every new table and index", () => {
    const markers = [
      "public.tenant_auth_policies",
      "public.tenant_auth_hosts",
      "public.auth_route_clients",
      "public.user_auth_identities",
      "public.auth_identity_enrollments",
      "public.auth_reconciliation_sets",
      "public.auth_cutover_runs",
      "public.auth_identity_proofs",
      "public.uq_user_auth_identities_cognito_sub",
      "public.uq_user_auth_identities_provider_subject",
      "public.uq_auth_reconciliation_sets_stage_revision",
      "public.uq_auth_cutover_runs_stage_inventory",
    ];
    for (const marker of markers) {
      expect(migration).toMatch(new RegExp(`-- creates: ${marker}\\b`));
    }
  });
});
