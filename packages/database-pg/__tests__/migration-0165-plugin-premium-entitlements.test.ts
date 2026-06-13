import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  PLUGIN_ENTITLEMENT_SOURCES,
  PLUGIN_ENTITLEMENT_STATUSES,
  PLUGIN_INSTALL_KEY_STATUSES,
  pluginEntitlements,
  pluginInstallKeys,
} from "../src/schema/plugins";
import * as schema from "../src/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0165 = readFileSync(
  join(HERE, "..", "drizzle", "0165_plugin_premium_entitlements.sql"),
  "utf-8",
);
const pluginTypes = readFileSync(
  join(HERE, "..", "graphql", "types", "plugins.graphql"),
  "utf-8",
);

describe("migration 0165 — premium plugin entitlements", () => {
  it("exports premium plugin tables and vocabularies from the schema index", () => {
    expect(schema.pluginEntitlements).toBe(pluginEntitlements);
    expect(schema.pluginInstallKeys).toBe(pluginInstallKeys);
    expect(schema.PLUGIN_ENTITLEMENT_STATUSES).toBe(
      PLUGIN_ENTITLEMENT_STATUSES,
    );
    expect(schema.PLUGIN_ENTITLEMENT_SOURCES).toBe(PLUGIN_ENTITLEMENT_SOURCES);
    expect(schema.PLUGIN_INSTALL_KEY_STATUSES).toBe(
      PLUGIN_INSTALL_KEY_STATUSES,
    );
  });

  it("models persistent tenant entitlements with one active row per tenant/plugin", () => {
    expect(getTableName(pluginEntitlements)).toBe("plugin_entitlements");
    const columns = getTableColumns(pluginEntitlements);
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.plugin_key.notNull).toBe(true);
    expect(columns.entitlement_product_key.notNull).toBe(true);
    expect(columns.status.notNull).toBe(true);
    expect(columns.source.notNull).toBe(true);
    expect(columns.granted_by_user_id.notNull).toBe(false);
    expect(columns.revoked_at.notNull).toBe(false);
    expect(columns.metadata.notNull).toBe(true);

    const config = getTableConfig(pluginEntitlements);
    const indexes = config.indexes.map((index) => index.config.name);
    expect(indexes).toContain("uq_plugin_entitlements_active_tenant_plugin");
    expect(indexes).toContain("idx_plugin_entitlements_tenant_plugin");
    expect(indexes).toContain("idx_plugin_entitlements_product_status");
    const activeUnique = config.indexes.find(
      (index) =>
        index.config.name === "uq_plugin_entitlements_active_tenant_plugin",
    );
    expect(activeUnique?.config.unique).toBe(true);
    expect(activeUnique?.config.where).toBeDefined();
  });

  it("models install keys as digest-only one-time records", () => {
    expect(getTableName(pluginInstallKeys)).toBe("plugin_install_keys");
    const columns = getTableColumns(pluginInstallKeys);
    expect(columns.plugin_key.notNull).toBe(true);
    expect(columns.entitlement_product_key.notNull).toBe(true);
    expect(columns.key_digest.notNull).toBe(true);
    expect(columns.digest_algorithm.notNull).toBe(true);
    expect(columns.key_secret_version.notNull).toBe(false);
    expect(columns.tenant_id.notNull).toBe(false);
    expect(columns.status.notNull).toBe(true);
    expect(columns.issued_by_user_id.notNull).toBe(false);
    expect(columns.redeemed_by_user_id.notNull).toBe(false);
    expect(columns.redeemed_tenant_id.notNull).toBe(false);
    expect(columns.redeemed_entitlement_id.notNull).toBe(false);
    expect(columns.redeemed_at.notNull).toBe(false);
    expect(columns.metadata.notNull).toBe(true);

    const config = getTableConfig(pluginInstallKeys);
    const indexes = config.indexes.map((index) => index.config.name);
    expect(indexes).toContain("uq_plugin_install_keys_digest");
    expect(indexes).toContain("idx_plugin_install_keys_lookup");
    expect(indexes).toContain("idx_plugin_install_keys_plugin_status");
    expect(indexes).toContain("idx_plugin_install_keys_tenant_status");
    expect(
      config.indexes.find(
        (index) => index.config.name === "uq_plugin_install_keys_digest",
      )?.config.unique,
    ).toBe(true);

    const entitlementFk = config.foreignKeys.find(
      (candidate) =>
        candidate.getName() === "plugin_install_keys_redeemed_entitlement_id_fk",
    );
    expect(entitlementFk).toBeDefined();
    expect(entitlementFk?.getName().length).toBeLessThanOrEqual(63);
    expect(entitlementFk?.onDelete).toBe("set null");
  });

  it("declares drift markers for premium tables, indexes, and constraints", () => {
    for (const marker of [
      "public.plugin_entitlements",
      "public.plugin_install_keys",
      "public.uq_plugin_entitlements_active_tenant_plugin",
      "public.idx_plugin_entitlements_tenant_plugin",
      "public.idx_plugin_entitlements_product_status",
      "public.uq_plugin_install_keys_digest",
      "public.idx_plugin_install_keys_lookup",
      "public.idx_plugin_install_keys_plugin_status",
      "public.idx_plugin_install_keys_tenant_status",
    ]) {
      expect(migration0165).toMatch(
        new RegExp(`--\\s*creates:\\s*${marker}\\b`),
      );
    }

    for (const marker of [
      "public.plugin_entitlements.plugin_entitlements_tenant_id_tenants_id_fk",
      "public.plugin_entitlements.plugin_entitlements_granted_by_user_id_users_id_fk",
      "public.plugin_entitlements.plugin_entitlements_status_allowed",
      "public.plugin_entitlements.plugin_entitlements_source_allowed",
      "public.plugin_install_keys.plugin_install_keys_tenant_id_tenants_id_fk",
      "public.plugin_install_keys.plugin_install_keys_issued_by_user_id_users_id_fk",
      "public.plugin_install_keys.plugin_install_keys_redeemed_by_user_id_users_id_fk",
      "public.plugin_install_keys.plugin_install_keys_redeemed_tenant_id_tenants_id_fk",
      "public.plugin_install_keys.plugin_install_keys_redeemed_entitlement_id_fk",
      "public.plugin_install_keys.plugin_install_keys_status_allowed",
      "public.plugin_install_keys.plugin_install_keys_redeemed_fields",
    ]) {
      expect(migration0165).toMatch(
        new RegExp(`--\\s*creates-constraint:\\s*${marker}\\b`),
      );
      expect(migration0165).toContain(marker.split(".").pop());
    }
  });

  it("keeps premium table FK and index names within Postgres's 63-char limit", () => {
    for (const table of [pluginEntitlements, pluginInstallKeys]) {
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        expect(fk.getName().length).toBeLessThanOrEqual(63);
      }
      for (const index of config.indexes) {
        expect(String(index.config.name).length).toBeLessThanOrEqual(63);
      }
    }
  });

  it("CHECK-constrains premium status and source vocabularies", () => {
    expect(PLUGIN_ENTITLEMENT_STATUSES).toEqual(["active", "revoked"]);
    expect(PLUGIN_ENTITLEMENT_SOURCES).toEqual([
      "install_key",
      "backdoor_key",
      "operator_grant",
      "migration",
    ]);
    expect(PLUGIN_INSTALL_KEY_STATUSES).toEqual([
      "issued",
      "redeemed",
      "revoked",
      "expired",
    ]);
    expect(migration0165).toContain("CHECK (status IN ('active', 'revoked'))");
    expect(migration0165).toContain(
      "CHECK (source IN ('install_key', 'backdoor_key', 'operator_grant', 'migration'))",
    );
    expect(migration0165).toContain(
      "CHECK (status IN ('issued', 'redeemed', 'revoked', 'expired'))",
    );
    expect(migration0165).toContain("plugin_install_keys_redeemed_fields");
  });

  it("exposes premium catalog and entitlement status in GraphQL without key digests", () => {
    expect(pluginTypes).toContain("type PluginCatalogPremium");
    expect(pluginTypes).toMatch(
      /type PluginCatalogPremium[\s\S]*?installKeyRequired: Boolean!/,
    );
    expect(pluginTypes).toContain("type PluginEntitlement");
    expect(pluginTypes).toMatch(/type PluginCatalogEntry[\s\S]*?premium:/);
    expect(pluginTypes).toMatch(/type PluginCatalogEntry[\s\S]*?entitlement:/);
    expect(pluginTypes).not.toContain("keyDigest");
    expect(pluginTypes).not.toContain("key_digest");
  });
});
