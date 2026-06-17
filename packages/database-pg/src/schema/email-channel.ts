/**
 * Email Channel domain tables.
 *
 * `email_reply_tokens` is the legacy SES reply-token substrate. THNK-35 adds
 * provider-neutral channel state around it so Resend and SES can share one
 * readiness, policy, ledger, and migration contract.
 */

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
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { agents } from "./agents";
import { spaces } from "./spaces";
import { threads } from "./threads";
import { messages } from "./messages";
import { inboxItems } from "./inbox-items";

export const EMAIL_CHANNEL_PROVIDERS = ["resend", "ses"] as const;
export type EmailChannelProvider = (typeof EMAIL_CHANNEL_PROVIDERS)[number];

export const EMAIL_PROVIDER_INSTALL_STATUSES = [
  "pending",
  "ready",
  "failed",
  "disabled",
] as const;
export type EmailProviderInstallStatus =
  (typeof EMAIL_PROVIDER_INSTALL_STATUSES)[number];

export const EMAIL_DOMAIN_OWNERSHIP_TYPES = [
  "thinkwork_owned",
  "customer_owned",
] as const;
export type EmailDomainOwnershipType =
  (typeof EMAIL_DOMAIN_OWNERSHIP_TYPES)[number];

export const EMAIL_DOMAIN_STATUSES = [
  "pending",
  "verified",
  "failed",
  "disabled",
] as const;
export type EmailDomainStatus = (typeof EMAIL_DOMAIN_STATUSES)[number];

export const EMAIL_READINESS_CHECK_KEYS = [
  "credentials",
  "sending_domain",
  "inbound_receiving",
  "webhook_signature",
  "provider_events",
  "loop_test",
] as const;
export type EmailReadinessCheckKey =
  (typeof EMAIL_READINESS_CHECK_KEYS)[number];

export const EMAIL_READINESS_STATUSES = [
  "pending",
  "pass",
  "fail",
  "blocked",
] as const;
export type EmailReadinessStatus = (typeof EMAIL_READINESS_STATUSES)[number];

export const EMAIL_BODY_DIRECTIONS = ["inbound", "outbound"] as const;
export type EmailBodyDirection = (typeof EMAIL_BODY_DIRECTIONS)[number];

export const EMAIL_CONVERSATION_STATUSES = [
  "pending_approval",
  "approved",
  "closed",
  "blocked",
] as const;
export type EmailConversationStatus =
  (typeof EMAIL_CONVERSATION_STATUSES)[number];

export const EMAIL_LEDGER_EVENT_TYPES = [
  "draft_created",
  "approval_requested",
  "approval_approved",
  "approval_denied",
  "send_blocked",
  "send_attempted",
  "send_succeeded",
  "send_failed",
  "inbound_received",
  "inbound_authorized",
  "inbound_rejected",
  "provider_event",
  "readiness_check",
  "body_retained",
  "body_redacted",
] as const;
export type EmailLedgerEventType = (typeof EMAIL_LEDGER_EVENT_TYPES)[number];

export const EMAIL_PROVIDER_EVENT_TYPES = [
  "sent",
  "delivered",
  "delayed",
  "failed",
  "bounced",
  "complained",
  "opened",
  "clicked",
  "received",
] as const;
export type EmailProviderEventType =
  (typeof EMAIL_PROVIDER_EVENT_TYPES)[number];

export const EMAIL_ALLOWLIST_TYPES = ["email", "domain"] as const;
export type EmailAllowlistType = (typeof EMAIL_ALLOWLIST_TYPES)[number];

const now = () => sql`now()`;

// ---------------------------------------------------------------------------
// Provider/domain readiness state
// ---------------------------------------------------------------------------

export const emailProviderInstalls = pgTable(
  "email_provider_installs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    display_name: text("display_name"),
    status: text("status").notNull().default("pending"),
    active_for_production: boolean("active_for_production")
      .notNull()
      .default(false),
    credential_secret_ref: text("credential_secret_ref"),
    webhook_secret_ref: text("webhook_secret_ref"),
    default_from_email: text("default_from_email"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now()),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now()),
  },
  (table) => [
    uniqueIndex("uq_email_provider_installs_tenant_provider").on(
      table.tenant_id,
      table.provider,
    ),
    uniqueIndex("uq_email_provider_installs_active")
      .on(table.tenant_id)
      .where(sql`${table.active_for_production} = true`),
    index("idx_email_provider_installs_tenant").on(table.tenant_id),
    index("idx_email_provider_installs_provider_status").on(
      table.tenant_id,
      table.provider,
      table.status,
    ),
    check(
      "email_provider_installs_provider_allowed",
      sql`${table.provider} IN ('resend', 'ses')`,
    ),
    check(
      "email_provider_installs_status_allowed",
      sql`${table.status} IN ('pending', 'ready', 'failed', 'disabled')`,
    ),
  ],
);

export const emailDomains = pgTable(
  "email_domains",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider_install_id: uuid("provider_install_id")
      .notNull()
      .references(() => emailProviderInstalls.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    ownership_type: text("ownership_type").notNull(),
    status: text("status").notNull().default("pending"),
    sending_verified_at: timestamp("sending_verified_at", {
      withTimezone: true,
    }),
    inbound_verified_at: timestamp("inbound_verified_at", {
      withTimezone: true,
    }),
    dns_records: jsonb("dns_records")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    provider_metadata: jsonb("provider_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now()),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now()),
  },
  (table) => [
    uniqueIndex("uq_email_domains_tenant_domain").on(
      table.tenant_id,
      table.domain,
    ),
    index("idx_email_domains_provider").on(table.provider_install_id),
    index("idx_email_domains_tenant_status").on(table.tenant_id, table.status),
    check(
      "email_domains_ownership_allowed",
      sql`${table.ownership_type} IN ('thinkwork_owned', 'customer_owned')`,
    ),
    check(
      "email_domains_status_allowed",
      sql`${table.status} IN ('pending', 'verified', 'failed', 'disabled')`,
    ),
  ],
);

export const emailReadinessChecks = pgTable(
  "email_readiness_checks",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider_install_id: uuid("provider_install_id")
      .notNull()
      .references(() => emailProviderInstalls.id, { onDelete: "cascade" }),
    domain_id: uuid("domain_id").references(() => emailDomains.id, {
      onDelete: "cascade",
    }),
    check_key: text("check_key").notNull(),
    status: text("status").notNull().default("pending"),
    last_checked_at: timestamp("last_checked_at", { withTimezone: true }),
    failure_code: text("failure_code"),
    failure_message: text("failure_message"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now()),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now()),
  },
  (table) => [
    uniqueIndex("uq_email_readiness_check_scope").on(
      table.tenant_id,
      table.provider_install_id,
      sql`COALESCE(${table.domain_id}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.check_key,
    ),
    index("idx_email_readiness_provider").on(table.provider_install_id),
    index("idx_email_readiness_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "email_readiness_check_key_allowed",
      sql`${table.check_key} IN ('credentials', 'sending_domain', 'inbound_receiving', 'webhook_signature', 'provider_events', 'loop_test')`,
    ),
    check(
      "email_readiness_status_allowed",
      sql`${table.status} IN ('pending', 'pass', 'fail', 'blocked')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Space policy and allowlists
// ---------------------------------------------------------------------------

export const emailSpacePolicies = pgTable(
  "email_space_policies",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    space_id: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    provider_install_id: uuid("provider_install_id").references(
      () => emailProviderInstalls.id,
      { onDelete: "set null" },
    ),
    enabled: boolean("enabled").notNull().default(false),
    registered_users_allowed: boolean("registered_users_allowed")
      .notNull()
      .default(true),
    private_space_membership_required: boolean(
      "private_space_membership_required",
    )
      .notNull()
      .default(true),
    outside_sender_default: text("outside_sender_default")
      .notNull()
      .default("deny"),
    first_send_review_required: boolean("first_send_review_required")
      .notNull()
      .default(true),
    policy: jsonb("policy")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now()),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now()),
  },
  (table) => [
    uniqueIndex("uq_email_space_policies_space").on(
      table.tenant_id,
      table.space_id,
    ),
    index("idx_email_space_policies_provider").on(table.provider_install_id),
    check(
      "email_space_policies_outside_default_allowed",
      sql`${table.outside_sender_default} IN ('deny', 'allowlist')`,
    ),
  ],
);

export const emailSpaceSenderAllowlists = pgTable(
  "email_space_sender_allowlists",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    space_id: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    value_type: text("value_type").notNull(),
    value: text("value").notNull(),
    reason: text("reason"),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now()),
  },
  (table) => [
    uniqueIndex("uq_email_sender_allowlist_value").on(
      table.tenant_id,
      table.space_id,
      table.value_type,
      table.value,
    ),
    index("idx_email_sender_allowlist_space").on(
      table.tenant_id,
      table.space_id,
    ),
    check(
      "email_sender_allowlist_type_allowed",
      sql`${table.value_type} IN ('email', 'domain')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Conversations, body refs, ledger, and provider events
// ---------------------------------------------------------------------------

export const emailConversations = pgTable(
  "email_conversations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    space_id: uuid("space_id").references(() => spaces.id, {
      onDelete: "set null",
    }),
    thread_id: uuid("thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    provider_install_id: uuid("provider_install_id").references(
      () => emailProviderInstalls.id,
      { onDelete: "set null" },
    ),
    subject: text("subject"),
    status: text("status").notNull().default("pending_approval"),
    approved_at: timestamp("approved_at", { withTimezone: true }),
    approved_by_user_id: uuid("approved_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    last_message_at: timestamp("last_message_at", { withTimezone: true }),
    participant_hash: text("participant_hash").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now()),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(now()),
  },
  (table) => [
    index("idx_email_conversations_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    index("idx_email_conversations_space").on(table.tenant_id, table.space_id),
    index("idx_email_conversations_thread").on(table.thread_id),
    uniqueIndex("uq_email_conversations_thread_participants")
      .on(table.tenant_id, table.thread_id, table.participant_hash)
      .where(sql`${table.thread_id} IS NOT NULL`),
    check(
      "email_conversations_status_allowed",
      sql`${table.status} IN ('pending_approval', 'approved', 'closed', 'blocked')`,
    ),
  ],
);

export const emailBodyObjects = pgTable(
  "email_body_objects",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversation_id: uuid("conversation_id").references(
      () => emailConversations.id,
      { onDelete: "cascade" },
    ),
    direction: text("direction").notNull(),
    content_hash: text("content_hash").notNull(),
    object_ref: text("object_ref").notNull(),
    retention_until: timestamp("retention_until", {
      withTimezone: true,
    }).notNull(),
    redacted_at: timestamp("redacted_at", { withTimezone: true }),
    redacted_by_user_id: uuid("redacted_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    redaction_reason: text("redaction_reason"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now()),
  },
  (table) => [
    index("idx_email_body_objects_conversation").on(table.conversation_id),
    index("idx_email_body_objects_retention").on(
      table.tenant_id,
      table.retention_until,
    ),
    check(
      "email_body_objects_direction_allowed",
      sql`${table.direction} IN ('inbound', 'outbound')`,
    ),
  ],
);

export const emailLedgerEvents = pgTable(
  "email_ledger_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversation_id: uuid("conversation_id").references(
      () => emailConversations.id,
      { onDelete: "set null" },
    ),
    space_id: uuid("space_id").references(() => spaces.id, {
      onDelete: "set null",
    }),
    thread_id: uuid("thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    message_id: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    inbox_item_id: uuid("inbox_item_id").references(() => inboxItems.id, {
      onDelete: "set null",
    }),
    provider_install_id: uuid("provider_install_id").references(
      () => emailProviderInstalls.id,
      { onDelete: "set null" },
    ),
    event_type: text("event_type").notNull(),
    provider_message_id: text("provider_message_id"),
    provider_event_id: text("provider_event_id"),
    actor_user_id: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    body_object_id: uuid("body_object_id").references(
      () => emailBodyObjects.id,
      {
        onDelete: "set null",
      },
    ),
    subject: text("subject"),
    from_email: text("from_email"),
    to_emails: jsonb("to_emails")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    reason_code: text("reason_code"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now()),
  },
  (table) => [
    index("idx_email_ledger_tenant_created").on(
      table.tenant_id,
      table.created_at,
    ),
    index("idx_email_ledger_conversation").on(table.conversation_id),
    index("idx_email_ledger_space").on(table.tenant_id, table.space_id),
    index("idx_email_ledger_provider_message").on(
      table.tenant_id,
      table.provider_message_id,
    ),
    check(
      "email_ledger_events_type_allowed",
      sql`${table.event_type} IN ('draft_created', 'approval_requested', 'approval_approved', 'approval_denied', 'send_blocked', 'send_attempted', 'send_succeeded', 'send_failed', 'inbound_received', 'inbound_authorized', 'inbound_rejected', 'provider_event', 'readiness_check', 'body_retained', 'body_redacted')`,
    ),
  ],
);

export const emailProviderEvents = pgTable(
  "email_provider_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider_install_id: uuid("provider_install_id")
      .notNull()
      .references(() => emailProviderInstalls.id, { onDelete: "cascade" }),
    ledger_event_id: uuid("ledger_event_id").references(
      () => emailLedgerEvents.id,
      { onDelete: "set null" },
    ),
    provider_event_id: text("provider_event_id").notNull(),
    provider_message_id: text("provider_message_id"),
    event_type: text("event_type").notNull(),
    occurred_at: timestamp("occurred_at", { withTimezone: true }),
    payload_metadata: jsonb("payload_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now()),
  },
  (table) => [
    uniqueIndex("uq_email_provider_events_provider_event").on(
      table.provider_install_id,
      table.provider_event_id,
    ),
    index("idx_email_provider_events_message").on(
      table.tenant_id,
      table.provider_message_id,
    ),
    index("idx_email_provider_events_type_created").on(
      table.provider_install_id,
      table.event_type,
      table.created_at,
    ),
    check(
      "email_provider_events_type_allowed",
      sql`${table.event_type} IN ('sent', 'delivered', 'delayed', 'failed', 'bounced', 'complained', 'opened', 'clicked', 'received')`,
    ),
  ],
);

export const emailSesCompatibilityMappings = pgTable(
  "email_ses_compatibility_mappings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider_install_id: uuid("provider_install_id")
      .notNull()
      .references(() => emailProviderInstalls.id, { onDelete: "cascade" }),
    reply_token_id: uuid("reply_token_id").references(
      () => emailReplyTokens.id,
      {
        onDelete: "set null",
      },
    ),
    conversation_id: uuid("conversation_id").references(
      () => emailConversations.id,
      { onDelete: "set null" },
    ),
    ses_message_id: text("ses_message_id"),
    legacy_thread_id: uuid("legacy_thread_id").references(() => threads.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(now()),
  },
  (table) => [
    uniqueIndex("uq_email_ses_mapping_token").on(table.reply_token_id),
    index("idx_email_ses_mapping_message").on(
      table.tenant_id,
      table.ses_message_id,
    ),
    index("idx_email_ses_mapping_conversation").on(table.conversation_id),
  ],
);

// ---------------------------------------------------------------------------
// email_reply_tokens
// ---------------------------------------------------------------------------

export const emailReplyTokens = pgTable(
  "email_reply_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id)
      .notNull(),
    agent_id: uuid("agent_id")
      .references(() => agents.id)
      .notNull(),
    token_hash: text("token_hash").notNull().unique(),
    context_type: text("context_type").notNull(),
    context_id: uuid("context_id").notNull(),
    recipient_email: text("recipient_email").notNull(),
    ses_message_id: text("ses_message_id"),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed_at: timestamp("consumed_at", { withTimezone: true }),
    max_uses: integer("max_uses").notNull().default(3),
    use_count: integer("use_count").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_email_reply_tokens_hash").on(table.token_hash),
    index("idx_email_reply_tokens_agent").on(table.agent_id),
    index("idx_email_reply_tokens_expires").on(
      table.tenant_id,
      table.expires_at,
    ),
    index("idx_email_reply_tokens_ses_msg").on(table.ses_message_id),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const emailReplyTokensRelations = relations(
  emailReplyTokens,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [emailReplyTokens.tenant_id],
      references: [tenants.id],
    }),
    agent: one(agents, {
      fields: [emailReplyTokens.agent_id],
      references: [agents.id],
    }),
  }),
);
