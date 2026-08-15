/**
 * Provider-neutral authentication control plane.
 *
 * These records intentionally live outside the plugin engine. A plugin may
 * retain an optional compatibility pointer during migration, but uninstalling
 * it cannot cascade Cognito resources, tenant policy, identity bindings, or
 * cutover evidence.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants, users } from "./core.js";
import { pluginInstalls } from "./plugins.js";

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

export const AUTH_CONNECTION_LIFECYCLE_STATES = [
  "coexistence",
  "native",
  "denied",
] as const;

export type AuthConnectionLifecycleState =
  (typeof AUTH_CONNECTION_LIFECYCLE_STATES)[number];

export const TENANT_AUTH_PROVIDER_REFERENCE_STATUSES = [
  "disabled",
  "enabled",
  "invalid",
  "decommissioning",
] as const;

export type TenantAuthProviderReferenceStatus =
  (typeof TENANT_AUTH_PROVIDER_REFERENCE_STATUSES)[number];

export const USER_AUTH_IDENTITY_STATUSES = [
  "pending_proof",
  "active",
  "quarantined",
  "revoked",
] as const;

export const AUTH_ENROLLMENT_STATUSES = [
  "pending",
  "consumed",
  "expired",
  "revoked",
] as const;

export const AUTH_CUTOVER_RUN_STATUSES = [
  "inventory",
  "ready",
  "cutting_over",
  "soaking",
  "rollback_required",
  "complete",
  "failed",
] as const;

export const AUTH_SUBSCRIPTION_TICKET_KINDS = [
  "connect",
  "registration",
] as const;

export const AUTH_SUBSCRIPTION_TICKET_STATUSES = [
  "issued",
  "consumed",
  "expired",
  "revoked",
] as const;

export const authProviderResources = pgTable(
  "auth_provider_resources",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    provider_key: text("provider_key").notNull(),
    connection_key: text("connection_key").notNull(),
    provider_kind: text("provider_kind").notNull(),
    display_name: text("display_name").notNull(),
    lifecycle_state: text("lifecycle_state").notNull().default("native"),
    cognito_user_pool_id: text("cognito_user_pool_id").notNull(),
    cognito_app_client_ids: jsonb("cognito_app_client_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    cognito_identity_provider_name: text(
      "cognito_identity_provider_name",
    ).notNull(),
    issuer_url: text("issuer_url"),
    client_id: text("client_id"),
    /** Secrets Manager/SSM reference only; never the secret value. */
    client_secret_ref: text("client_secret_ref"),
    resource_arn: text("resource_arn"),
    aws_account_id: text("aws_account_id"),
    aws_region: text("aws_region"),
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
    desired_revision: integer("desired_revision").notNull().default(1),
    validation_status: text("validation_status")
      .notNull()
      .default("unconfigured"),
    public_options_published: boolean("public_options_published")
      .notNull()
      .default(false),
    last_validated_at: timestamp("last_validated_at", { withTimezone: true }),
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
    uniqueIndex("uq_auth_provider_resources_connection_key").on(
      table.cognito_user_pool_id,
      table.connection_key,
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
      "auth_provider_resources_lifecycle_state_allowed",
      sql`${table.lifecycle_state} IN ('native', 'denied')`,
    ),
    check(
      "auth_provider_resources_public_option_mode_allowed",
      sql`${table.public_option_mode} IN ('single_sso', 'provider_specific')`,
    ),
    check(
      "auth_provider_resources_no_public_without_valid",
      sql`${table.public_options_published} = false OR (${table.validation_status} = 'valid' AND ${table.lifecycle_state} <> 'denied')`,
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
      .references(() => tenants.id, { onDelete: "restrict" }),
    /** Optional legacy ownership pointer; its DB FK uses ON DELETE SET NULL. */
    plugin_install_id: uuid("plugin_install_id").references(
      () => pluginInstalls.id,
      { onDelete: "set null" },
    ),
    auth_provider_resource_id: uuid("auth_provider_resource_id")
      .notNull()
      .references(() => authProviderResources.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("disabled"),
    hostnames: jsonb("hostnames")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    public_option_label: text("public_option_label")
      .notNull()
      .default("Continue with SSO"),
    desired_revision: integer("desired_revision").notNull().default(1),
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
    uniqueIndex("uq_tenant_auth_provider_references_tenant_resource").on(
      table.tenant_id,
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

export const tenantAuthPolicies = pgTable(
  "tenant_auth_policies",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    local_password_enabled: boolean("local_password_enabled")
      .notNull()
      .default(true),
    status: text("status").notNull().default("draft"),
    revision: integer("revision").notNull().default(1),
    catalog_revision: text("catalog_revision"),
    updated_by: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_tenant_auth_policies_tenant").on(table.tenant_id),
    check(
      "tenant_auth_policies_status_allowed",
      sql`${table.status} IN ('draft', 'active', 'disabled')`,
    ),
  ],
);

export const tenantAuthHosts = pgTable(
  "tenant_auth_hosts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    hostname: text("hostname").notNull(),
    status: text("status").notNull().default("pending"),
    verified_at: timestamp("verified_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_tenant_auth_hosts_hostname").on(table.hostname),
    index("idx_tenant_auth_hosts_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "tenant_auth_hosts_status_allowed",
      sql`${table.status} IN ('pending', 'verified', 'disabled')`,
    ),
  ],
);

export const authRouteClients = pgTable(
  "auth_route_clients",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    route_key: text("route_key").notNull(),
    client_family: text("client_family").notNull(),
    cognito_user_pool_id: text("cognito_user_pool_id").notNull(),
    cognito_app_client_id: text("cognito_app_client_id").notNull(),
    provider_names: jsonb("provider_names")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    explicit_auth_flows: jsonb("explicit_auth_flows")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    redirect_uris: jsonb("redirect_uris")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    logout_uris: jsonb("logout_uris")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    lifecycle_state: text("lifecycle_state").notNull().default("native"),
    validation_status: text("validation_status")
      .notNull()
      .default("unconfigured"),
    desired_revision: integer("desired_revision").notNull().default(1),
    resource_arn: text("resource_arn"),
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
    uniqueIndex("uq_auth_route_clients_route_family").on(
      table.route_key,
      table.client_family,
    ),
    uniqueIndex("uq_auth_route_clients_app_client").on(
      table.cognito_app_client_id,
    ),
    index("idx_auth_route_clients_lifecycle_status").on(
      table.lifecycle_state,
      table.validation_status,
    ),
    check(
      "auth_route_clients_lifecycle_allowed",
      sql`${table.lifecycle_state} IN ('native', 'denied')`,
    ),
    check(
      "auth_route_clients_validation_allowed",
      sql`${table.validation_status} IN ('unconfigured', 'validating', 'valid', 'partially_valid', 'invalid', 'rotating_secret', 'disabled')`,
    ),
  ],
);

export const userAuthIdentities = pgTable(
  "user_auth_identities",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    auth_provider_resource_id: uuid("auth_provider_resource_id").references(
      () => authProviderResources.id,
      { onDelete: "restrict" },
    ),
    cognito_issuer: text("cognito_issuer").notNull(),
    cognito_sub: text("cognito_sub").notNull(),
    provider_issuer: text("provider_issuer").notNull(),
    provider_subject: text("provider_subject").notNull(),
    status: text("status").notNull().default("pending_proof"),
    proof_kind: text("proof_kind").notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    activated_at: timestamp("activated_at", { withTimezone: true }),
    quarantined_at: timestamp("quarantined_at", { withTimezone: true }),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // One enrollment per (subject, connection) — NOT one per subject
    // (0288, Eric 2026-08-15): a Cognito user with linked providers keeps
    // one sub across lanes, and each lane needs its own enrollment. The
    // one-subject-one-product-user invariant moved into the writers'
    // cross-user guards.
    uniqueIndex("uq_user_auth_identities_sub_connection").on(
      table.cognito_issuer,
      table.cognito_sub,
      table.auth_provider_resource_id,
    ),
    uniqueIndex("uq_user_auth_identities_provider_subject").on(
      table.auth_provider_resource_id,
      table.provider_issuer,
      table.provider_subject,
    ),
    index("idx_user_auth_identities_user_status").on(
      table.user_id,
      table.status,
    ),
    index("idx_user_auth_identities_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "user_auth_identities_status_allowed",
      sql`${table.status} IN ('pending_proof', 'active', 'quarantined', 'revoked')`,
    ),
    check(
      "user_auth_identities_active_has_resource",
      sql`${table.status} = 'quarantined' OR ${table.auth_provider_resource_id} IS NOT NULL`,
    ),
  ],
);

export const authIdentityEnrollments = pgTable(
  "auth_identity_enrollments",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    intended_user_id: uuid("intended_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    recipient_grant_kind: text("recipient_grant_kind").notNull(),
    recipient_grant_id: uuid("recipient_grant_id").notNull(),
    auth_provider_resource_id: uuid("auth_provider_resource_id")
      .notNull()
      .references(() => authProviderResources.id, { onDelete: "restrict" }),
    auth_route_client_id: uuid("auth_route_client_id")
      .notNull()
      .references(() => authRouteClients.id, { onDelete: "restrict" }),
    redirect_uri: text("redirect_uri").notNull(),
    nonce_digest: text("nonce_digest").notNull(),
    recipient_challenge_digest: text("recipient_challenge_digest").notNull(),
    failed_attempts: integer("failed_attempts").notNull().default(0),
    locked_at: timestamp("locked_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed_at: timestamp("consumed_at", { withTimezone: true }),
    proof: jsonb("proof")
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
    uniqueIndex("uq_auth_identity_enrollments_nonce").on(table.nonce_digest),
    uniqueIndex("uq_auth_identity_enrollments_challenge").on(
      table.recipient_challenge_digest,
    ),
    index("idx_auth_identity_enrollments_pending").on(
      table.tenant_id,
      table.status,
      table.expires_at,
    ),
    check(
      "auth_identity_enrollments_status_allowed",
      sql`${table.status} IN ('pending', 'consumed', 'expired', 'revoked')`,
    ),
    check(
      "auth_identity_enrollments_grant_kind_allowed",
      sql`${table.recipient_grant_kind} IN ('membership', 'pending_owner', 'identity_recovery', 'session_migration')`,
    ),
    check(
      "auth_identity_enrollments_failed_attempts_nonnegative",
      sql`${table.failed_attempts} >= 0`,
    ),
  ],
);

export const authReconciliationSets = pgTable(
  "auth_reconciliation_sets",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    stage: text("stage").notNull(),
    revision: integer("revision").notNull(),
    idempotency_key: text("idempotency_key").notNull(),
    manifest_fingerprint: text("manifest_fingerprint").notNull(),
    desired_connections: jsonb("desired_connections")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    status: text("status").notNull().default("pending"),
    applied_at: timestamp("applied_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_auth_reconciliation_sets_stage_revision").on(
      table.stage,
      table.revision,
    ),
    uniqueIndex("uq_auth_reconciliation_sets_idempotency").on(
      table.idempotency_key,
    ),
    check(
      "auth_reconciliation_sets_status_allowed",
      sql`${table.status} IN ('pending', 'applied', 'rejected')`,
    ),
  ],
);

export const authCutoverRuns = pgTable(
  "auth_cutover_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    stage: text("stage").notNull(),
    tenant_id: uuid("tenant_id"),
    inventory_fingerprint: text("inventory_fingerprint").notNull(),
    status: text("status").notNull().default("inventory"),
    terminal_dispositions: jsonb("terminal_dispositions")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    client_shutdown_evidence: jsonb("client_shutdown_evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    drain_evidence: jsonb("drain_evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    started_at: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_auth_cutover_runs_stage_inventory").on(
      table.stage,
      table.inventory_fingerprint,
    ),
    index("idx_auth_cutover_runs_status").on(table.stage, table.status),
    check(
      "auth_cutover_runs_status_allowed",
      sql`${table.status} IN ('inventory', 'ready', 'cutting_over', 'soaking', 'rollback_required', 'complete', 'failed')`,
    ),
  ],
);

export const authIdentityProofs = pgTable(
  "auth_identity_proofs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    user_auth_identity_id: uuid("user_auth_identity_id")
      .notNull()
      .references(() => userAuthIdentities.id, { onDelete: "restrict" }),
    proof_digest: text("proof_digest").notNull(),
    proof_kind: text("proof_kind").notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    observed_at: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_auth_identity_proofs_digest").on(table.proof_digest),
    index("idx_auth_identity_proofs_identity").on(table.user_auth_identity_id),
  ],
);

/**
 * One-use AppSync Lambda-authorization tickets. Only the nonce digest is
 * persisted: the signed bearer token and its signature never enter Postgres.
 */
export const authSubscriptionTickets = pgTable(
  "auth_subscription_tickets",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    nonce_digest: text("nonce_digest").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("issued"),
    stage: text("stage").notNull(),
    appsync_api_id: text("appsync_api_id").notNull(),
    key_id: text("key_id").notNull(),
    cognito_issuer: text("cognito_issuer").notNull(),
    cognito_sub: text("cognito_sub").notNull(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    auth_route_client_id: uuid("auth_route_client_id")
      .notNull()
      .references(() => authRouteClients.id, { onDelete: "restrict" }),
    operation_name: text("operation_name"),
    operation_hash: text("operation_hash"),
    resource_kind: text("resource_kind"),
    resource_id: text("resource_id"),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed_at: timestamp("consumed_at", { withTimezone: true }),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_auth_subscription_tickets_nonce").on(table.nonce_digest),
    index("idx_auth_subscription_tickets_principal").on(
      table.cognito_issuer,
      table.cognito_sub,
      table.status,
    ),
    index("idx_auth_subscription_tickets_expiry").on(
      table.status,
      table.expires_at,
    ),
    check(
      "auth_subscription_tickets_kind_allowed",
      sql`${table.kind} IN ('connect', 'registration')`,
    ),
    check(
      "auth_subscription_tickets_status_allowed",
      sql`${table.status} IN ('issued', 'consumed', 'expired', 'revoked')`,
    ),
    check(
      "auth_subscription_tickets_operation_shape",
      sql`(${table.kind} = 'connect' AND ${table.operation_name} IS NULL AND ${table.operation_hash} IS NULL) OR (${table.kind} = 'registration' AND ${table.operation_name} IS NOT NULL AND ${table.operation_hash} IS NOT NULL)`,
    ),
  ],
);

/** Durable requests to disconnect already-open, now-revoked subscriptions. */
export const authSubscriptionInvalidations = pgTable(
  "auth_subscription_invalidations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    user_id: uuid("user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    resource_kind: text("resource_kind").notNull(),
    resource_id: text("resource_id"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    available_at: timestamp("available_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    processed_at: timestamp("processed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_auth_subscription_invalidations_pending").on(
      table.status,
      table.available_at,
    ),
    check(
      "auth_subscription_invalidations_status_allowed",
      sql`${table.status} IN ('pending', 'processing', 'complete', 'failed')`,
    ),
  ],
);

export const authProviderResourcesRelations = relations(
  authProviderResources,
  ({ many }) => ({
    tenantReferences: many(tenantAuthProviderReferences),
    identities: many(userAuthIdentities),
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

export const userAuthIdentitiesRelations = relations(
  userAuthIdentities,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [userAuthIdentities.tenant_id],
      references: [tenants.id],
    }),
    user: one(users, {
      fields: [userAuthIdentities.user_id],
      references: [users.id],
    }),
    resource: one(authProviderResources, {
      fields: [userAuthIdentities.auth_provider_resource_id],
      references: [authProviderResources.id],
    }),
    proofs: many(authIdentityProofs),
  }),
);
