/**
 * Core domain tables: tenants, users, user_profiles, tenant_settings, tenant_members.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// Sandbox environment IDs — the two AgentCore Code Interpreter environments a
// tenant can be provisioned for. See docs/plans/2026-04-22-006-feat-agentcore-
// code-sandbox-plan.md Unit 4.
export const SANDBOX_ENVIRONMENTS = [
  "default-public",
  "internal-only",
] as const;
export type SandboxEnvironment = (typeof SANDBOX_ENVIRONMENTS)[number];

// Compliance-tier labels. Only `standard` may run the sandbox at all; the
// compound CHECK on the tenants table enforces this at the schema layer so
// raw SQL cannot bypass the application gate.
export const COMPLIANCE_TIERS = ["standard", "regulated", "hipaa"] as const;
export type ComplianceTier = (typeof COMPLIANCE_TIERS)[number];

// ---------------------------------------------------------------------------
// 0.4 — tenants
// ---------------------------------------------------------------------------

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    plan: text("plan").notNull().default("pro"),
    issue_prefix: text("issue_prefix"),
    issue_counter: integer("issue_counter").notNull().default(0),
    channel_counters: jsonb("channel_counters").notNull().default({}),
    // Compounding-memory feature gate. Off for every tenant at migration time;
    // flipped on per tenant as the wiki-compile pipeline is rolled out. Checked
    // by the memory-retain → wiki-compile enqueue path.
    wiki_compile_enabled: boolean("wiki_compile_enabled")
      .notNull()
      .default(false),
    // Sandbox (AgentCore Code Interpreter) kill switch. Default-true for
    // forward semantics: new tenants opt in. The Phase 1 migration sets this
    // to false on every pre-existing row in the same transaction so existing
    // enterprise tenants don't auto-opt-in before Phase 3b enforcement lands.
    sandbox_enabled: boolean("sandbox_enabled").notNull().default(true),
    // Compliance classification. Only `standard` tenants may enable sandbox;
    // regulated/hipaa tenants are blocked by the compound CHECK below.
    compliance_tier: text("compliance_tier").notNull().default("standard"),
    // Per-tenant Code Interpreter IDs, populated asynchronously by the
    // agentcore-admin Lambda. Null during the provisioning window; dispatcher
    // gates on ID-present independently of sandbox_enabled (plan R-Q10).
    sandbox_interpreter_public_id: text("sandbox_interpreter_public_id"),
    sandbox_interpreter_internal_id: text("sandbox_interpreter_internal_id"),
    // Set by the stripe-webhook Lambda when a checkout.session.completed event
    // pre-provisions a paid tenant. bootstrapUser later matches this column
    // to a Google-signed-in user's email and claims the tenant (attaches the
    // user as owner, clears this column). NULL for tenants created by
    // bootstrapUser directly (free signups) or once a paid tenant is claimed.
    // Partial unique index enforced via drizzle/0022_stripe_billing_indexes.sql.
    pending_owner_email: text("pending_owner_email"),
    // Soft-delete marker for canceled / churned tenants. Set by the
    // stripe-webhook Lambda when customer.subscription.deleted fires
    // (and in the future, by any other deactivation path: operator
    // delete, abuse lockout). A separate scheduled sweeper hard-deletes
    // rows where deactivated_at < now() - 30 days. See
    // docs/plans/2026-04-23-001-feat-stripe-upgrade-and-cancel-soft-delete-plan.md.
    deactivated_at: timestamp("deactivated_at", { withTimezone: true }),
    // Human-readable reason ('stripe_subscription_canceled',
    // 'operator_delete', etc.). Free-text so new reasons don't need a
    // migration.
    deactivation_reason: text("deactivation_reason"),
    // Per-tenant kill switches for built-in tools (plan #007 §R6, R7). JSONB
    // array of slug strings ['execute_code', 'web_search', ...]. Empty array
    // = all built-ins available (subject to template blocks). Runtime filter
    // intersects with template.blocked_tools at Agent(tools=...) construction;
    // tenant disable always wins (a template cannot unblock what the tenant
    // disabled). Admin UI for editing this column defers per the plan's
    // §Scope Boundaries → Deferred to Follow-Up Work.
    disabled_builtin_tools: jsonb("disabled_builtin_tools")
      .notNull()
      .default([]),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    check(
      "tenants_compliance_tier_allowed",
      sql`${table.compliance_tier} IN ('standard','regulated','hipaa')`,
    ),
    // Regulated-tenant invariant: sandbox cannot be enabled unless tier is
    // `standard`. Closes the "raw SQL or db:push bypass" hole at the schema
    // layer. App-layer check in updateTenantPolicy is the primary gate; this
    // is belt-and-suspenders.
    check(
      "tenants_sandbox_requires_standard_tier",
      sql`NOT (${table.sandbox_enabled} = true AND ${table.compliance_tier} != 'standard')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 0.5 — users
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id").references(() => tenants.id),
    email: text("email").unique(),
    name: text("name"),
    image: text("image"),
    email_verified_at: timestamp("email_verified_at", {
      withTimezone: true,
    }),
    phone: text("phone"),
    phone_verified_at: timestamp("phone_verified_at", {
      withTimezone: true,
    }),
    expo_push_token: text("expo_push_token"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("idx_users_email").on(table.email),
    index("idx_users_tenant_id").on(table.tenant_id),
  ],
);

// ---------------------------------------------------------------------------
// 0.6 — user_profiles
// ---------------------------------------------------------------------------

export const userProfiles = pgTable("user_profiles", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  user_id: uuid("user_id")
    .references(() => users.id)
    .unique(),
  tenant_id: uuid("tenant_id").references(() => tenants.id),
  display_name: text("display_name"),
  theme: text("theme").default("system"),
  notification_preferences: jsonb("notification_preferences"),
  /**
   * Profession / role label (e.g., "Founder", "VP Engineering"). Rendered into
   * agent USER.md as {{HUMAN_TITLE}} at assignment time. Null → renders as "—".
   */
  title: text("title"),
  /**
   * IANA timezone identifier (e.g., "America/Chicago"). Rendered into agent
   * USER.md as {{HUMAN_TIMEZONE}} at assignment time. Null → renders as "—".
   */
  timezone: text("timezone"),
  /**
   * Preferred pronouns (free text, e.g., "he/him", "they/them"). Rendered into
   * agent USER.md as {{HUMAN_PRONOUNS}} at assignment time. Null → renders as "—".
   */
  pronouns: text("pronouns"),
  /**
   * Short/preferred name — what the agent should call this human in chat
   * ("Eric" vs the full "Eric Odom"). Maintained by the agent via the
   * `update_user_profile` tool when the human says "just call me X".
   * Rendered into USER.md as {{HUMAN_CALL_BY}}. Null → renders as "—".
   */
  call_by: text("call_by"),
  /**
   * Free-form notes the agent maintains about the human — communication
   * preferences, working style, context. Rendered into USER.md as
   * {{HUMAN_NOTES}}. Null → renders as "—".
   *
   * Phone number for USER.md's {{HUMAN_PHONE}} is read from `users.phone`
   * — that column already exists for account-level contact info. No
   * separate profile column.
   */
  notes: text("notes"),
  /**
   * Free-form markdown describing the human's family / close contacts.
   * Rendered under USER.md's `## Family` section as {{HUMAN_FAMILY}}.
   * Null → renders as "—".
   */
  family: text("family"),
  /**
   * Free-form markdown capturing ongoing context about the human — projects,
   * recurring topics, situational color. Rendered under USER.md's
   * `## Context` section as {{HUMAN_CONTEXT}}. Null → renders as "—".
   */
  context: text("context"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 0.7 — tenant_settings
// ---------------------------------------------------------------------------

export const tenantSettings = pgTable("tenant_settings", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  tenant_id: uuid("tenant_id")
    .references(() => tenants.id)
    .unique(),
  default_model: text("default_model"),
  budget_monthly_cents: integer("budget_monthly_cents"),
  auto_close_thread_minutes: integer("auto_close_thread_minutes").default(30),
  max_agents: integer("max_agents"),
  features: jsonb("features"),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

// ---------------------------------------------------------------------------
// 0.8 — tenant_members (Paperclip pattern)
// ---------------------------------------------------------------------------

export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    principal_type: text("principal_type").notNull(),
    principal_id: uuid("principal_id").notNull(),
    role: text("role").notNull().default("member"),
    status: text("status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_tenant_members_tenant").on(table.tenant_id),
    index("idx_tenant_members_principal").on(
      table.principal_type,
      table.principal_id,
    ),
    uniqueIndex("uq_tenant_members_principal").on(
      table.tenant_id,
      table.principal_type,
      table.principal_id,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle query builder)
// ---------------------------------------------------------------------------

export const tenantsRelations = relations(tenants, ({ many, one }) => ({
  users: many(users),
  settings: one(tenantSettings),
  members: many(tenantMembers),
}));

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, {
    fields: [users.tenant_id],
    references: [tenants.id],
  }),
  profile: one(userProfiles),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.user_id],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [userProfiles.tenant_id],
    references: [tenants.id],
  }),
}));

export const tenantSettingsRelations = relations(tenantSettings, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantSettings.tenant_id],
    references: [tenants.id],
  }),
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantMembers.tenant_id],
    references: [tenants.id],
  }),
}));
