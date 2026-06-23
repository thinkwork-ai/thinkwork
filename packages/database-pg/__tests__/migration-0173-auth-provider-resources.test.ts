import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  AUTH_PROVIDER_PUBLIC_OPTION_MODES,
  AUTH_PROVIDER_VALIDATION_STATUSES,
  TENANT_AUTH_PROVIDER_REFERENCE_STATUSES,
  authProviderResources,
  tenantAuthProviderReferences,
} from "../src/schema/plugins";
import * as schema from "../src/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0173 = readFileSync(
  join(HERE, "..", "drizzle", "0173_auth_provider_resources.sql"),
  "utf-8",
);
const pluginTypes = readFileSync(
  join(HERE, "..", "graphql", "types", "plugins.graphql"),
  "utf-8",
);

describe("migration 0173 — auth-provider resources", () => {
  it("exports auth-provider tables and vocabularies from the schema index", () => {
    expect(schema.authProviderResources).toBe(authProviderResources);
    expect(schema.tenantAuthProviderReferences).toBe(
      tenantAuthProviderReferences,
    );
    expect(schema.AUTH_PROVIDER_VALIDATION_STATUSES).toBe(
      AUTH_PROVIDER_VALIDATION_STATUSES,
    );
    expect(schema.AUTH_PROVIDER_PUBLIC_OPTION_MODES).toBe(
      AUTH_PROVIDER_PUBLIC_OPTION_MODES,
    );
    expect(schema.TENANT_AUTH_PROVIDER_REFERENCE_STATUSES).toBe(
      TENANT_AUTH_PROVIDER_REFERENCE_STATUSES,
    );
  });

  it("models deployment-level auth-provider resource state without raw secrets", () => {
    expect(getTableName(authProviderResources)).toBe("auth_provider_resources");
    expect(AUTH_PROVIDER_VALIDATION_STATUSES).toEqual([
      "unconfigured",
      "validating",
      "valid",
      "partially_valid",
      "invalid",
      "rotating_secret",
      "disabled",
    ]);
    expect(AUTH_PROVIDER_PUBLIC_OPTION_MODES).toEqual([
      "single_sso",
      "provider_specific",
    ]);

    const columns = getTableColumns(authProviderResources);
    expect(columns.provider_key.notNull).toBe(true);
    expect(columns.cognito_user_pool_id.notNull).toBe(true);
    expect(columns.cognito_identity_provider_name.notNull).toBe(true);
    expect(columns.issuer_url.notNull).toBe(true);
    expect(columns.client_id.notNull).toBe(true);
    expect(columns.client_secret_ref.notNull).toBe(true);
    expect(columns.public_options_published.notNull).toBe(true);

    const indexes = getTableConfig(authProviderResources).indexes.map(
      (index) => index.config.name,
    );
    expect(indexes).toContain("uq_auth_provider_resources_cognito_idp");
    expect(indexes).toContain("idx_auth_provider_resources_provider_status");
  });

  it("models tenant auth-provider references separately from user activations", () => {
    expect(getTableName(tenantAuthProviderReferences)).toBe(
      "tenant_auth_provider_references",
    );
    expect(TENANT_AUTH_PROVIDER_REFERENCE_STATUSES).toEqual([
      "disabled",
      "enabled",
      "invalid",
      "decommissioning",
    ]);

    const columns = getTableColumns(tenantAuthProviderReferences);
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.plugin_install_id.notNull).toBe(true);
    expect(columns.auth_provider_resource_id.notNull).toBe(true);
    expect(columns.hostnames.notNull).toBe(true);
    expect(columns.public_option_label.notNull).toBe(true);

    const config = getTableConfig(tenantAuthProviderReferences);
    const indexes = config.indexes.map((index) => index.config.name);
    expect(indexes).toContain(
      "uq_tenant_auth_provider_references_install_resource",
    );
    expect(indexes).toContain(
      "idx_tenant_auth_provider_references_tenant_status",
    );
    expect(indexes).toContain("idx_tenant_auth_provider_references_resource");
    expect(config.foreignKeys.map((fk) => fk.onDelete)).toContain("cascade");
  });

  it("declares drift markers and widens plugin component type checks", () => {
    for (const marker of [
      "public.auth_provider_resources",
      "public.tenant_auth_provider_references",
      "public.uq_auth_provider_resources_cognito_idp",
      "public.idx_auth_provider_resources_provider_status",
      "public.uq_tenant_auth_provider_references_install_resource",
      "public.idx_tenant_auth_provider_references_tenant_status",
      "public.idx_tenant_auth_provider_references_resource",
    ]) {
      expect(migration0173).toMatch(
        new RegExp(`--\\s*creates:\\s*${marker}\\b`),
      );
    }
    expect(migration0173).toContain(
      "CHECK (component_type IN ('mcp-server', 'skills', 'infrastructure', 'ui-surface', 'auth-provider'))",
    );
    expect(migration0173).toContain(
      "CHECK (public_options_published = false OR validation_status IN ('valid', 'partially_valid'))",
    );
  });

  it("exposes admin-safe GraphQL types without client secret values", () => {
    expect(pluginTypes).toContain("type AuthProviderResource");
    expect(pluginTypes).toContain("clientSecretConfigured: Boolean!");
    expect(pluginTypes).toContain("type TenantAuthProviderReference");
    expect(pluginTypes).toContain("resource: AuthProviderResource!");
    expect(typeBlock("AuthProviderResource")).not.toContain("clientSecret:");
    expect(typeBlock("ConfigureWorkosAuthPluginResult")).not.toContain(
      "clientSecret",
    );
    expect(pluginTypes).toContain("input ConfigureWorkosAuthPluginInput");
    expect(pluginTypes).toContain(
      "Write-only. Required for first-time setup; omit to keep the existing secret.",
    );
    expect(pluginTypes).toContain("clientSecret: String");
    expect(pluginTypes).not.toContain("clientSecretRef");
  });
});

function typeBlock(typeName: string): string {
  return (
    pluginTypes.match(new RegExp(`type ${typeName} \\{[\\s\\S]*?\\n\\}`))?.[0] ??
    ""
  );
}
