import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  PLUGIN_COMPONENT_STATES,
  PLUGIN_COMPONENT_TYPES,
  PLUGIN_INSTALL_STATES,
  USER_PLUGIN_ACTIVATION_STATUSES,
  USER_PLUGIN_ACTIVATION_TOKEN_STATUSES,
  pluginComponents,
  pluginInstalls,
  userPluginActivationTokens,
  userPluginActivations,
} from "../src/schema/plugins";
import { tenantMcpServers } from "../src/schema/mcp-servers";
import * as schema from "../src/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0159 = readFileSync(
  join(HERE, "..", "drizzle", "0159_application_plugins.sql"),
  "utf-8",
);
const pluginTypes = readFileSync(
  join(HERE, "..", "graphql", "types", "plugins.graphql"),
  "utf-8",
);

describe("migration 0159 — application plugin engine schema", () => {
  it("exports the plugin tables and state vocabularies from the schema index", () => {
    expect(schema.pluginInstalls).toBe(pluginInstalls);
    expect(schema.pluginComponents).toBe(pluginComponents);
    expect(schema.userPluginActivations).toBe(userPluginActivations);
    expect(schema.userPluginActivationTokens).toBe(userPluginActivationTokens);
    expect(schema.PLUGIN_INSTALL_STATES).toBe(PLUGIN_INSTALL_STATES);
    expect(schema.PLUGIN_COMPONENT_STATES).toBe(PLUGIN_COMPONENT_STATES);
  });

  it("models the install state machine vocabulary", () => {
    expect(PLUGIN_INSTALL_STATES).toEqual([
      "installing",
      "awaiting_approval",
      "installed",
      "partially_installed",
      "failed",
      "uninstalling",
    ]);
    expect(PLUGIN_COMPONENT_STATES).toEqual([
      "pending",
      "provisioned",
      "failed",
    ]);
    expect(PLUGIN_COMPONENT_TYPES).toEqual([
      "mcp-server",
      "skills",
      "infrastructure",
      "ui-surface",
    ]);
    expect(USER_PLUGIN_ACTIVATION_STATUSES).toEqual([
      "active",
      "needs_reauth",
      "revoked",
    ]);
    expect(USER_PLUGIN_ACTIVATION_TOKEN_STATUSES).toEqual([
      "active",
      "expired",
      "revoked",
    ]);
  });

  it("pins both the catalog version and payload sha256 on plugin_installs", () => {
    expect(getTableName(pluginInstalls)).toBe("plugin_installs");
    const columns = getTableColumns(pluginInstalls);
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.plugin_key.notNull).toBe(true);
    expect(columns.pinned_version.notNull).toBe(true);
    expect(columns.pinned_payload_sha256.notNull).toBe(true);
    expect(columns.state.notNull).toBe(true);
    expect(columns.state.default).toBeDefined();
    expect(columns.idempotency_key.notNull).toBe(true);
    expect(columns.last_transition_at.notNull).toBe(true);
    expect(columns.last_error.notNull).toBe(false);

    const indexes = getTableConfig(pluginInstalls).indexes.map(
      (index) => index.config.name,
    );
    expect(indexes).toContain("uq_plugin_installs_tenant_plugin");
    expect(indexes).toContain("idx_plugin_installs_tenant_state");
    const unique = getTableConfig(pluginInstalls).indexes.find(
      (index) => index.config.name === "uq_plugin_installs_tenant_plugin",
    );
    expect(unique?.config.unique).toBe(true);
  });

  it("keys plugin_components by (install, component key) with cascade delete", () => {
    expect(getTableName(pluginComponents)).toBe("plugin_components");
    const columns = getTableColumns(pluginComponents);
    expect(columns.plugin_install_id.notNull).toBe(true);
    expect(columns.component_key.notNull).toBe(true);
    expect(columns.component_type.notNull).toBe(true);
    expect(columns.state.notNull).toBe(true);
    expect(columns.handler_ref.notNull).toBe(true);
    expect(columns.last_error.notNull).toBe(false);

    const config = getTableConfig(pluginComponents);
    const indexes = config.indexes.map((index) => index.config.name);
    expect(indexes).toContain("uq_plugin_components_install_key");
    expect(indexes).toContain("idx_plugin_components_install");
    const unique = config.indexes.find(
      (index) => index.config.name === "uq_plugin_components_install_key",
    );
    expect(unique?.config.unique).toBe(true);

    const installFk = config.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === "plugin_install_id"),
    );
    expect(installFk?.onDelete).toBe("cascade");
  });

  it("enforces one activation per (user, install) and indexes activatedUserCount", () => {
    expect(getTableName(userPluginActivations)).toBe("user_plugin_activations");
    const columns = getTableColumns(userPluginActivations);
    expect(columns.user_id.notNull).toBe(true);
    expect(columns.plugin_install_id.notNull).toBe(true);
    expect(columns.status.notNull).toBe(true);
    expect(columns.granted_scopes.notNull).toBe(true);
    expect(columns.granted_at.notNull).toBe(true);
    expect(columns.revoked_at.notNull).toBe(false);

    const config = getTableConfig(userPluginActivations);
    const unique = config.indexes.find(
      (index) => index.config.name === "uq_user_plugin_activations",
    );
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((c) => "name" in c && c.name)).toEqual([
      "user_id",
      "plugin_install_id",
    ]);
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "idx_user_plugin_activations_install",
    );
  });

  it("keys token records by (activation, resource indicator) with cascade delete", () => {
    expect(getTableName(userPluginActivationTokens)).toBe(
      "user_plugin_activation_tokens",
    );
    const columns = getTableColumns(userPluginActivationTokens);
    expect(columns.activation_id.notNull).toBe(true);
    expect(columns.resource_indicator.notNull).toBe(true);
    expect(columns.secret_ref.notNull).toBe(true);
    expect(columns.status.notNull).toBe(true);
    expect(columns.expires_at.notNull).toBe(false);

    const config = getTableConfig(userPluginActivationTokens);
    const unique = config.indexes.find(
      (index) =>
        index.config.name === "uq_user_plugin_activation_tokens_resource",
    );
    expect(unique?.config.unique).toBe(true);

    // Explicit short FK name — the drizzle-derived name would exceed
    // Postgres's 63-char identifier limit and silently truncate.
    const fk = config.foreignKeys.find(
      (candidate) =>
        candidate.getName() ===
        "user_plugin_activation_tokens_activation_id_fk",
    );
    expect(fk).toBeDefined();
    expect(fk?.getName().length).toBeLessThanOrEqual(63);
    expect(fk?.onDelete).toBe("cascade");
  });

  it("adds the nullable plugin ownership column to tenant_mcp_servers", () => {
    const columns = getTableColumns(tenantMcpServers);
    expect(columns.plugin_install_id).toBeDefined();
    expect(columns.plugin_install_id.notNull).toBe(false);

    const fk = getTableConfig(tenantMcpServers).foreignKeys.find((candidate) =>
      candidate.reference().columns.some((c) => c.name === "plugin_install_id"),
    );
    expect(fk?.onDelete).toBe("set null");
  });

  it("keeps every constraint name within Postgres's 63-char identifier limit", () => {
    for (const table of [
      pluginInstalls,
      pluginComponents,
      userPluginActivations,
      userPluginActivationTokens,
      tenantMcpServers,
    ]) {
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        expect(fk.getName().length).toBeLessThanOrEqual(63);
      }
      for (const index of config.indexes) {
        expect(String(index.config.name).length).toBeLessThanOrEqual(63);
      }
    }
  });

  it("declares drift markers for tables, indexes, column, and constraints", () => {
    for (const marker of [
      "public.plugin_installs",
      "public.plugin_components",
      "public.user_plugin_activations",
      "public.user_plugin_activation_tokens",
      "public.uq_plugin_installs_tenant_plugin",
      "public.idx_plugin_installs_tenant_state",
      "public.uq_plugin_components_install_key",
      "public.idx_plugin_components_install",
      "public.uq_user_plugin_activations",
      "public.idx_user_plugin_activations_install",
      "public.uq_user_plugin_activation_tokens_resource",
    ]) {
      expect(migration0159).toMatch(
        new RegExp(`--\\s*creates:\\s*${marker}\\b`),
      );
    }

    expect(migration0159).toMatch(
      /--\s*creates-column:\s*public\.tenant_mcp_servers\.plugin_install_id\b/,
    );

    for (const marker of [
      "public.plugin_installs.plugin_installs_tenant_id_tenants_id_fk",
      "public.plugin_installs.plugin_installs_state_allowed",
      "public.plugin_components.plugin_components_plugin_install_id_plugin_installs_id_fk",
      "public.plugin_components.plugin_components_state_allowed",
      "public.plugin_components.plugin_components_type_allowed",
      "public.user_plugin_activations.user_plugin_activations_user_id_users_id_fk",
      "public.user_plugin_activations.user_plugin_activations_plugin_install_id_plugin_installs_id_fk",
      "public.user_plugin_activations.user_plugin_activations_status_allowed",
      "public.user_plugin_activation_tokens.user_plugin_activation_tokens_activation_id_fk",
      "public.user_plugin_activation_tokens.user_plugin_activation_tokens_status_allowed",
      "public.tenant_mcp_servers.tenant_mcp_servers_plugin_install_id_plugin_installs_id_fk",
    ]) {
      expect(migration0159).toMatch(
        new RegExp(`--\\s*creates-constraint:\\s*${marker}\\b`),
      );
      expect(migration0159).toContain(marker.split(".").pop());
    }
  });

  it("CHECK-constrains state vocabularies in the migration SQL", () => {
    expect(migration0159).toContain(
      "CHECK (state IN ('installing', 'awaiting_approval', 'installed', 'partially_installed', 'failed', 'uninstalling'))",
    );
    expect(migration0159).toContain(
      "CHECK (state IN ('pending', 'provisioned', 'failed'))",
    );
    expect(migration0159).toContain(
      "CHECK (component_type IN ('mcp-server', 'skills', 'infrastructure', 'ui-surface'))",
    );
    expect(migration0159).toContain(
      "CHECK (status IN ('active', 'needs_reauth', 'revoked'))",
    );
    expect(migration0159).toContain(
      "CHECK (status IN ('active', 'expired', 'revoked'))",
    );
  });

  it("exposes the plugin engine in GraphQL source types without token secrets", () => {
    expect(pluginTypes).toContain("type PluginInstall");
    expect(pluginTypes).toMatch(
      /type PluginInstall[\s\S]*?pinnedVersion: String!/,
    );
    expect(pluginTypes).toMatch(/type PluginInstall[\s\S]*?state: String!/);
    expect(pluginTypes).toMatch(
      /type PluginInstall[\s\S]*?components: \[PluginComponent!\]!/,
    );
    expect(pluginTypes).toMatch(
      /type PluginInstall[\s\S]*?activatedUserCount: Int!/,
    );
    expect(pluginTypes).toContain("type PluginComponent");
    expect(pluginTypes).toContain("type UserPluginActivation");
    expect(pluginTypes).not.toContain("secretRef");
    expect(pluginTypes).not.toContain("tokens:");

    expect(pluginTypes).toContain("pluginCatalog: [PluginCatalogEntry!]!");
    expect(pluginTypes).toContain("pluginInstalls: [PluginInstall!]!");
    expect(pluginTypes).toContain("pluginInstall(id: ID!): PluginInstall");
    expect(pluginTypes).toContain(
      "myPluginActivations: [UserPluginActivation!]!",
    );

    expect(pluginTypes).toContain(
      "installPlugin(input: InstallPluginInput!): PluginInstall!",
    );
    expect(pluginTypes).toContain(
      "upgradePlugin(input: UpgradePluginInput!): PluginInstall!",
    );
    expect(pluginTypes).toContain(
      "uninstallPlugin(input: UninstallPluginInput!): PluginInstall!",
    );
    expect(pluginTypes).toContain(
      "retryPluginComponent(input: RetryPluginComponentInput!): PluginInstall!",
    );
    expect(pluginTypes).toContain(
      "activatePlugin(input: ActivatePluginInput!): ActivatePluginResult!",
    );
    expect(pluginTypes).toContain(
      "deactivatePlugin(input: DeactivatePluginInput!): UserPluginActivation!",
    );
    expect(pluginTypes).toMatch(
      /type ActivatePluginResult[\s\S]*?authorizeUrl: String!/,
    );
  });

  it("declares no AppSync subscriptions (no notification_mutations wiring needed)", () => {
    expect(pluginTypes).not.toContain("@aws_subscribe");
    expect(pluginTypes).not.toContain("extend type Subscription");
  });
});
