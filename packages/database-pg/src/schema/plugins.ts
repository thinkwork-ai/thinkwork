/**
 * Application plugin engine tables: plugin_installs, plugin_components,
 * user_plugin_activations, user_plugin_activation_tokens.
 *
 * The plugin engine is the canonical record of install, component, and
 * activation state (plan 2026-06-12-001 U4). Handlers reconcile real runtime
 * rows (tenant_mcp_servers, skill catalog folders, managed_applications);
 * these tables hold orchestration state only — no shadow copies of runtime
 * state. Component completion for async infrastructure jobs reconciles at
 * read time against the linked deployment job's events (no readiness
 * snapshots, no push mechanism).
 *
 * Activation model: one grant per (user, plugin install) holding N token
 * records — one per RFC 8707 resource indicator the plugin's MCP servers
 * require. Activations survive version upgrades (no FK to a version); an
 * upgrade whose required scopes are no longer covered flips the activation
 * to 'needs_reauth'.
 */

import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core.js";

// ---------------------------------------------------------------------------
// State vocabularies
// ---------------------------------------------------------------------------

/**
 * Install state machine:
 * installing → awaiting_approval (infra plan ready) → installing (approved)
 * → installed | partially_installed | failed, with awaiting_approval → failed
 * on rejection and installed → uninstalling on admin uninstall. An install
 * stuck in 'installing' past a staleness threshold (see last_transition_at)
 * is re-drivable: the install mutation re-enters the handler sequence
 * idempotently instead of returning the wedged row.
 */
export const PLUGIN_INSTALL_STATES = [
  "installing",
  "awaiting_approval",
  "installed",
  "partially_installed",
  "failed",
  "uninstalling",
] as const;

export type PluginInstallState = (typeof PLUGIN_INSTALL_STATES)[number];

/**
 * Per-component provisioning state: pending → provisioned | failed, with
 * failed → pending on retry. No rollback-all — partial failures hold the
 * install at 'partially_installed' with per-component retry.
 */
export const PLUGIN_COMPONENT_STATES = [
  "pending",
  "provisioned",
  "failed",
] as const;

export type PluginComponentState = (typeof PLUGIN_COMPONENT_STATES)[number];

/**
 * Component types mirror @thinkwork/plugin-catalog PLUGIN_COMPONENT_TYPES.
 * Kept as a string column (CHECK-constrained) so the schema package stays
 * decoupled from the catalog package.
 */
export const PLUGIN_COMPONENT_TYPES = [
  "mcp-server",
  "skills",
  "infrastructure",
  "ui-surface",
  "auth-provider",
] as const;

export type PluginComponentTypeValue = (typeof PLUGIN_COMPONENT_TYPES)[number];

export const USER_PLUGIN_ACTIVATION_STATUSES = [
  "active",
  "needs_reauth",
  "revoked",
] as const;

export type UserPluginActivationStatus =
  (typeof USER_PLUGIN_ACTIVATION_STATUSES)[number];

/** Mirrors user_mcp_tokens.status vocabulary. */
export const USER_PLUGIN_ACTIVATION_TOKEN_STATUSES = [
  "active",
  "expired",
  "revoked",
] as const;

export type UserPluginActivationTokenStatus =
  (typeof USER_PLUGIN_ACTIVATION_TOKEN_STATUSES)[number];

export const PLUGIN_ENTITLEMENT_STATUSES = ["active", "revoked"] as const;

export type PluginEntitlementStatus =
  (typeof PLUGIN_ENTITLEMENT_STATUSES)[number];

export const PLUGIN_ENTITLEMENT_SOURCES = [
  "install_key",
  "backdoor_key",
  "operator_grant",
  "migration",
] as const;

export type PluginEntitlementSource =
  (typeof PLUGIN_ENTITLEMENT_SOURCES)[number];

export const PLUGIN_INSTALL_KEY_STATUSES = [
  "issued",
  "redeemed",
  "revoked",
  "expired",
] as const;

export type PluginInstallKeyStatus =
  (typeof PLUGIN_INSTALL_KEY_STATUSES)[number];

export const AUTH_PROVIDER_VALIDATION_STATUSES = [
  "unconfigured",
  "validating",
  "valid",
  "partially_valid",
  "invalid",
  "rotating_secret",
  "disabled",
] as const;

export type AuthProviderValidationStatus =
  (typeof AUTH_PROVIDER_VALIDATION_STATUSES)[number];

export const AUTH_PROVIDER_PUBLIC_OPTION_MODES = [
  "single_sso",
  "provider_specific",
] as const;

export type AuthProviderPublicOptionMode =
  (typeof AUTH_PROVIDER_PUBLIC_OPTION_MODES)[number];

export const TENANT_AUTH_PROVIDER_REFERENCE_STATUSES = [
  "disabled",
  "enabled",
  "invalid",
  "decommissioning",
] as const;

export type TenantAuthProviderReferenceStatus =
  (typeof TENANT_AUTH_PROVIDER_REFERENCE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Premium plugin entitlements and one-time install keys
// ---------------------------------------------------------------------------

export const pluginEntitlements = pgTable(
  "plugin_entitlements",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Plugin key from the signed catalog (e.g. "company-brain"). */
    plugin_key: text("plugin_key").notNull(),
    /** Premium product key from manifest premium.entitlementProductKey. */
    entitlement_product_key: text("entitlement_product_key").notNull(),
    status: text("status").notNull().default("active"),
    /** install_key | backdoor_key | operator_grant | migration. */
    source: text("source").notNull(),
    granted_by_user_id: uuid("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    granted_at: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_plugin_entitlements_active_tenant_plugin")
      .on(table.tenant_id, table.plugin_key)
      .where(sql`${table.status} = 'active'`),
    index("idx_plugin_entitlements_tenant_plugin").on(
      table.tenant_id,
      table.plugin_key,
    ),
    index("idx_plugin_entitlements_product_status").on(
      table.entitlement_product_key,
      table.status,
    ),
    check(
      "plugin_entitlements_status_allowed",
      sql`${table.status} IN ('active', 'revoked')`,
    ),
    check(
      "plugin_entitlements_source_allowed",
      sql`${table.source} IN ('install_key', 'backdoor_key', 'operator_grant', 'migration')`,
    ),
  ],
);

export const pluginInstallKeys = pgTable(
  "plugin_install_keys",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Plugin key from the signed catalog (e.g. "company-brain"). */
    plugin_key: text("plugin_key").notNull(),
    /** Premium product key the key grants when redeemed. */
    entitlement_product_key: text("entitlement_product_key").notNull(),
    /** Digest only; raw keys are returned once by the issuer and never stored. */
    key_digest: text("key_digest").notNull(),
    digest_algorithm: text("digest_algorithm").notNull().default("sha256"),
    /** Optional secret/pepper version for HMAC-backed digests. */
    key_secret_version: text("key_secret_version"),
    /** Optional tenant scope; null means any tenant can redeem once. */
    tenant_id: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("issued"),
    issued_by_user_id: uuid("issued_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    issued_at: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    redeemed_by_user_id: uuid("redeemed_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    redeemed_tenant_id: uuid("redeemed_tenant_id").references(
      () => tenants.id,
      { onDelete: "set null" },
    ),
    redeemed_entitlement_id: uuid("redeemed_entitlement_id"),
    redeemed_at: timestamp("redeemed_at", { withTimezone: true }),
    audit_correlation_id: text("audit_correlation_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "plugin_install_keys_redeemed_entitlement_id_fk",
      columns: [table.redeemed_entitlement_id],
      foreignColumns: [pluginEntitlements.id],
    }).onDelete("set null"),
    uniqueIndex("uq_plugin_install_keys_digest").on(table.key_digest),
    index("idx_plugin_install_keys_lookup").on(
      table.plugin_key,
      table.key_digest,
    ),
    index("idx_plugin_install_keys_plugin_status").on(
      table.plugin_key,
      table.status,
    ),
    index("idx_plugin_install_keys_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "plugin_install_keys_status_allowed",
      sql`${table.status} IN ('issued', 'redeemed', 'revoked', 'expired')`,
    ),
    check(
      "plugin_install_keys_redeemed_fields",
      sql`${table.status} <> 'redeemed' OR (${table.redeemed_at} IS NOT NULL AND ${table.redeemed_tenant_id} IS NOT NULL AND ${table.redeemed_entitlement_id} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// plugin_installs — one row per (tenant, plugin); pins the catalog version
// ---------------------------------------------------------------------------

export const pluginInstalls = pgTable(
  "plugin_installs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Plugin key from the signed catalog (SLUG_RE-shaped, e.g. "lastmile"). */
    plugin_key: text("plugin_key").notNull(),
    /** Catalog version string pinned at install/upgrade time. */
    pinned_version: text("pinned_version").notNull(),
    /** sha256 of the pinned version payload (pluginVersionSha256). */
    pinned_payload_sha256: text("pinned_payload_sha256").notNull(),
    state: text("state").notNull().default("installing"),
    /** Dedupes concurrent install mutations for the same (tenant, plugin). */
    idempotency_key: text("idempotency_key").notNull(),
    /**
     * Set on every state transition. Staleness re-drive input: an install
     * sitting in 'installing' past the threshold with no in-flight infra job
     * re-enters the handler sequence idempotently.
     */
    last_transition_at: timestamp("last_transition_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** Most recent engine-level failure (component errors live on the component row). */
    last_error: text("last_error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_plugin_installs_tenant_plugin").on(
      table.tenant_id,
      table.plugin_key,
    ),
    index("idx_plugin_installs_tenant_state").on(table.tenant_id, table.state),
    check(
      "plugin_installs_state_allowed",
      sql`${table.state} IN ('installing', 'awaiting_approval', 'installed', 'partially_installed', 'failed', 'uninstalling')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// plugin_components — per-component provisioning state under an install
// ---------------------------------------------------------------------------

export const pluginComponents = pgTable(
  "plugin_components",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    plugin_install_id: uuid("plugin_install_id")
      .notNull()
      .references(() => pluginInstalls.id, { onDelete: "cascade" }),
    /** Component key from the manifest (unique within the install). */
    component_key: text("component_key").notNull(),
    /** 'mcp-server' | 'skills' | 'infrastructure' | 'ui-surface' | 'auth-provider'. */
    component_type: text("component_type").notNull(),
    state: text("state").notNull().default("pending"),
    /**
     * Handler linkage into real runtime rows — the read-time reconciliation
     * input. Shape by component type:
     *   - mcp-server:     { tenantMcpServerId }
     *   - skills:         { seededCatalogPrefix, workspaceFolders: string[] }
     *   - infrastructure: { managedApplicationId, deploymentJobId }
     *   - ui-surface:     {} (declared-only in v1)
     *   - auth-provider:  { status: 'unconfigured', publicOptionsPublished: false }
     */
    handler_ref: jsonb("handler_ref")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    last_error: text("last_error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_plugin_components_install_key").on(
      table.plugin_install_id,
      table.component_key,
    ),
    index("idx_plugin_components_install").on(table.plugin_install_id),
    check(
      "plugin_components_state_allowed",
      sql`${table.state} IN ('pending', 'provisioned', 'failed')`,
    ),
    check(
      "plugin_components_type_allowed",
      sql`${table.component_type} IN ('mcp-server', 'skills', 'infrastructure', 'ui-surface', 'auth-provider')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Auth-provider configuration — deployment resource + tenant references
// ---------------------------------------------------------------------------

export const authProviderResources = pgTable(
  "auth_provider_resources",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Catalog/provider key, currently "workos". */
    provider_key: text("provider_key").notNull(),
    display_name: text("display_name").notNull(),
    cognito_user_pool_id: text("cognito_user_pool_id").notNull(),
    cognito_app_client_ids: jsonb("cognito_app_client_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    cognito_identity_provider_name: text(
      "cognito_identity_provider_name",
    ).notNull(),
    issuer_url: text("issuer_url").notNull(),
    client_id: text("client_id").notNull(),
    /**
     * Secrets Manager/SSM reference only. The WorkOS client secret value is
     * never stored in Postgres or exposed through GraphQL.
     */
    client_secret_ref: text("client_secret_ref").notNull(),
    authorize_scopes: text("authorize_scopes")
      .notNull()
      .default("openid profile email"),
    public_option_mode: text("public_option_mode")
      .notNull()
      .default("single_sso"),
    provider_options: jsonb("provider_options")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    validation_status: text("validation_status")
      .notNull()
      .default("unconfigured"),
    public_options_published: boolean("public_options_published")
      .notNull()
      .default(false),
    last_validated_at: timestamp("last_validated_at", {
      withTimezone: true,
    }),
    last_error_code: text("last_error_code"),
    diagnostics: jsonb("diagnostics")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_auth_provider_resources_cognito_idp").on(
      table.provider_key,
      table.cognito_user_pool_id,
      table.cognito_identity_provider_name,
    ),
    index("idx_auth_provider_resources_provider_status").on(
      table.provider_key,
      table.validation_status,
    ),
    check(
      "auth_provider_resources_validation_status_allowed",
      sql`${table.validation_status} IN ('unconfigured', 'validating', 'valid', 'partially_valid', 'invalid', 'rotating_secret', 'disabled')`,
    ),
    check(
      "auth_provider_resources_public_option_mode_allowed",
      sql`${table.public_option_mode} IN ('single_sso', 'provider_specific')`,
    ),
    check(
      "auth_provider_resources_no_public_without_valid",
      sql`${table.public_options_published} = false OR ${table.validation_status} IN ('valid', 'partially_valid')`,
    ),
  ],
);

export const tenantAuthProviderReferences = pgTable(
  "tenant_auth_provider_references",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    plugin_install_id: uuid("plugin_install_id")
      .notNull()
      .references(() => pluginInstalls.id, { onDelete: "cascade" }),
    auth_provider_resource_id: uuid("auth_provider_resource_id")
      .notNull()
      .references(() => authProviderResources.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("disabled"),
    hostnames: jsonb("hostnames")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    public_option_label: text("public_option_label")
      .notNull()
      .default("Continue with SSO"),
    enabled_at: timestamp("enabled_at", { withTimezone: true }),
    disabled_at: timestamp("disabled_at", { withTimezone: true }),
    last_error_code: text("last_error_code"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_tenant_auth_provider_references_install_resource").on(
      table.tenant_id,
      table.plugin_install_id,
      table.auth_provider_resource_id,
    ),
    index("idx_tenant_auth_provider_references_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    index("idx_tenant_auth_provider_references_resource").on(
      table.auth_provider_resource_id,
    ),
    check(
      "tenant_auth_provider_references_status_allowed",
      sql`${table.status} IN ('disabled', 'enabled', 'invalid', 'decommissioning')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// user_plugin_activations — one app-level OAuth grant per (user, install)
// ---------------------------------------------------------------------------

export const userPluginActivations = pgTable(
  "user_plugin_activations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Canonical caller user id, verified end-to-end at the OAuth callback. */
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plugin_install_id: uuid("plugin_install_id")
      .notNull()
      .references(() => pluginInstalls.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    /** Scope set granted at consent time: string[]. */
    granted_scopes: jsonb("granted_scopes")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    granted_at: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Doubles as the dispatch-time activation lookup index
    // (user_id, plugin_install_id).
    uniqueIndex("uq_user_plugin_activations").on(
      table.user_id,
      table.plugin_install_id,
    ),
    // activatedUserCount: count of 'active' activations per install.
    index("idx_user_plugin_activations_install").on(table.plugin_install_id),
    check(
      "user_plugin_activations_status_allowed",
      sql`${table.status} IN ('active', 'needs_reauth', 'revoked')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// user_plugin_activation_tokens — one token record per resource indicator
// ---------------------------------------------------------------------------

export const userPluginActivationTokens = pgTable(
  "user_plugin_activation_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    activation_id: uuid("activation_id").notNull(),
    /** RFC 8707 resource indicator the token is audience-bound to. */
    resource_indicator: text("resource_indicator").notNull(),
    /**
     * Secrets Manager ref:
     * thinkwork/{stage}/plugin-tokens/{userId}/{pluginInstallId}/{resourceKey}
     */
    secret_ref: text("secret_ref").notNull(),
    status: text("status").notNull().default("active"),
    /** When the access token expires (refresh-on-expiry per token record). */
    expires_at: timestamp("expires_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Explicit short FK name: drizzle's derived name exceeds Postgres's
    // 63-char identifier limit and would be silently truncated.
    foreignKey({
      name: "user_plugin_activation_tokens_activation_id_fk",
      columns: [table.activation_id],
      foreignColumns: [userPluginActivations.id],
    }).onDelete("cascade"),
    uniqueIndex("uq_user_plugin_activation_tokens_resource").on(
      table.activation_id,
      table.resource_indicator,
    ),
    check(
      "user_plugin_activation_tokens_status_allowed",
      sql`${table.status} IN ('active', 'expired', 'revoked')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const pluginEntitlementsRelations = relations(
  pluginEntitlements,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [pluginEntitlements.tenant_id],
      references: [tenants.id],
    }),
    grantedByUser: one(users, {
      fields: [pluginEntitlements.granted_by_user_id],
      references: [users.id],
    }),
    redeemedKeys: many(pluginInstallKeys),
  }),
);

export const pluginInstallKeysRelations = relations(
  pluginInstallKeys,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [pluginInstallKeys.tenant_id],
      references: [tenants.id],
    }),
    issuedByUser: one(users, {
      fields: [pluginInstallKeys.issued_by_user_id],
      references: [users.id],
    }),
    redeemedByUser: one(users, {
      fields: [pluginInstallKeys.redeemed_by_user_id],
      references: [users.id],
    }),
    redeemedTenant: one(tenants, {
      fields: [pluginInstallKeys.redeemed_tenant_id],
      references: [tenants.id],
    }),
    redeemedEntitlement: one(pluginEntitlements, {
      fields: [pluginInstallKeys.redeemed_entitlement_id],
      references: [pluginEntitlements.id],
    }),
  }),
);

export const pluginInstallsRelations = relations(
  pluginInstalls,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [pluginInstalls.tenant_id],
      references: [tenants.id],
    }),
    components: many(pluginComponents),
    activations: many(userPluginActivations),
  }),
);

export const pluginComponentsRelations = relations(
  pluginComponents,
  ({ one }) => ({
    install: one(pluginInstalls, {
      fields: [pluginComponents.plugin_install_id],
      references: [pluginInstalls.id],
    }),
  }),
);

export const authProviderResourcesRelations = relations(
  authProviderResources,
  ({ many }) => ({
    tenantReferences: many(tenantAuthProviderReferences),
  }),
);

export const tenantAuthProviderReferencesRelations = relations(
  tenantAuthProviderReferences,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [tenantAuthProviderReferences.tenant_id],
      references: [tenants.id],
    }),
    install: one(pluginInstalls, {
      fields: [tenantAuthProviderReferences.plugin_install_id],
      references: [pluginInstalls.id],
    }),
    resource: one(authProviderResources, {
      fields: [tenantAuthProviderReferences.auth_provider_resource_id],
      references: [authProviderResources.id],
    }),
  }),
);

export const userPluginActivationsRelations = relations(
  userPluginActivations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [userPluginActivations.user_id],
      references: [users.id],
    }),
    install: one(pluginInstalls, {
      fields: [userPluginActivations.plugin_install_id],
      references: [pluginInstalls.id],
    }),
    tokens: many(userPluginActivationTokens),
  }),
);

export const userPluginActivationTokensRelations = relations(
  userPluginActivationTokens,
  ({ one }) => ({
    activation: one(userPluginActivations, {
      fields: [userPluginActivationTokens.activation_id],
      references: [userPluginActivations.id],
    }),
  }),
);
