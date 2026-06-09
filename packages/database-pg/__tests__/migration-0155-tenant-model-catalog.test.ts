import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { tenantModelCatalog } from "../src/schema/agents";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0155 = readFileSync(
  join(HERE, "..", "drizzle", "0155_tenant_model_catalog.sql"),
  "utf-8",
);
const agentTypes = readFileSync(
  join(HERE, "..", "graphql", "types", "agents.graphql"),
  "utf-8",
);

describe("migration 0155 - tenant model catalog", () => {
  it("models tenant-scoped Bedrock catalog rows in Drizzle", () => {
    const columns = getTableColumns(tenantModelCatalog);

    expect(getTableName(tenantModelCatalog)).toBe("tenant_model_catalog");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.model_id.notNull).toBe(true);
    expect(columns.display_name.notNull).toBe(true);
    expect(columns.enabled.notNull).toBe(true);
    expect(columns.enabled.default).toBe(false);
    expect(columns.pricing_status.notNull).toBe(true);
    expect(columns.pricing_status.default).toBe("missing");
    expect(columns.pricing_source.notNull).toBe(false);
    expect(columns.pricing_diagnostics.notNull).toBe(true);
    expect(columns.import_source.notNull).toBe(true);
    expect(columns.import_source.default).toBe("backfill");
    expect(columns.import_payload.notNull).toBe(true);
    expect(columns.imported_by_user_id.notNull).toBe(false);
    expect(columns.imported_at.notNull).toBe(true);
    expect(columns.created_at.notNull).toBe(true);
    expect(columns.updated_at.notNull).toBe(true);

    const config = getTableConfig(tenantModelCatalog);
    expect(config.primaryKeys).toHaveLength(1);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(
      ["tenant_id", "model_id"],
    );
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "idx_tenant_model_catalog_tenant_enabled",
        "idx_tenant_model_catalog_model",
      ]),
    );
    expect(config.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "tenant_model_catalog_pricing_status_allowed",
        "tenant_model_catalog_enabled_requires_resolved_pricing",
      ]),
    );
  });

  it("declares drift markers for table, indexes, and constraints", () => {
    for (const marker of [
      "public.tenant_model_catalog",
      "public.idx_tenant_model_catalog_tenant_enabled",
      "public.idx_tenant_model_catalog_model",
    ]) {
      expect(migration0155).toMatch(
        new RegExp(`--\\s*creates:\\s*${marker}\\b`),
      );
    }

    for (const marker of [
      "public.tenant_model_catalog.tenant_model_catalog_pkey",
      "public.tenant_model_catalog.tenant_model_catalog_tenant_id_tenants_id_fk",
      "public.tenant_model_catalog.tenant_model_catalog_model_id_model_catalog_model_id_fk",
      "public.tenant_model_catalog.tenant_model_catalog_imported_by_user_id_users_id_fk",
      "public.tenant_model_catalog.tenant_model_catalog_pricing_status_allowed",
      "public.tenant_model_catalog.tenant_model_catalog_enabled_requires_resolved_pricing",
    ]) {
      expect(migration0155).toMatch(
        new RegExp(`--\\s*creates-constraint:\\s*${marker}\\b`),
      );
      expect(migration0155).toContain(marker.split(".").pop());
    }
  });

  it("backfills existing tenant model references without enabling unpriced rows", () => {
    for (const source of [
      "FROM public.tenant_settings",
      "FROM public.agents",
      "FROM public.agent_templates",
      "FROM public.agent_profiles",
      "FROM public.user_model_approvals",
    ]) {
      expect(migration0155).toContain(source);
    }

    expect(migration0155).toContain("mc.is_available IS TRUE");
    expect(migration0155).toContain("legacy-model-catalog");
    expect(migration0155).toContain(
      "input_cost_per_million IS NOT NULL AND output_cost_per_million IS NOT NULL",
    );
    expect(migration0155).toContain(
      "ON CONFLICT (tenant_id, model_id) DO NOTHING",
    );
  });

  it("exposes a tenant catalog entry shape in GraphQL source types", () => {
    expect(agentTypes).toContain("type TenantModelCatalogEntry");
    expect(agentTypes).toMatch(
      /type TenantModelCatalogEntry[\s\S]*displayName: String!/,
    );
    expect(agentTypes).toMatch(
      /type TenantModelCatalogEntry[\s\S]*canonicalDisplayName: String!/,
    );
    expect(agentTypes).toMatch(
      /type TenantModelCatalogEntry[\s\S]*pricingStatus: String!/,
    );
    expect(agentTypes).toMatch(
      /type TenantModelCatalogEntry[\s\S]*importedByUserId: ID/,
    );
  });
});
