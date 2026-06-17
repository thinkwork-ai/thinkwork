import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  EMAIL_CHANNEL_PROVIDERS,
  EMAIL_LEDGER_EVENT_TYPES,
  EMAIL_PROVIDER_INSTALL_STATUSES,
  EMAIL_READINESS_CHECK_KEYS,
  emailBodyObjects,
  emailConversations,
  emailDomains,
  emailLedgerEvents,
  emailProviderEvents,
  emailProviderInstalls,
  emailReadinessChecks,
  emailReplyTokens,
  emailSesCompatibilityMappings,
  emailSpacePolicies,
  emailSpaceSenderAllowlists,
} from "../src/schema/email-channel";
import * as schema from "../src/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0170 = readFileSync(
  join(HERE, "..", "drizzle", "0170_email_channel_plugin.sql"),
  "utf-8",
);
const rollback0170 = readFileSync(
  join(HERE, "..", "drizzle", "0170_email_channel_plugin_rollback.sql"),
  "utf-8",
);

describe("migration 0170 — Email Channel plugin schema", () => {
  it("exports provider-neutral email channel tables from the schema index", () => {
    expect(schema.emailProviderInstalls).toBe(emailProviderInstalls);
    expect(schema.emailDomains).toBe(emailDomains);
    expect(schema.emailReadinessChecks).toBe(emailReadinessChecks);
    expect(schema.emailSpacePolicies).toBe(emailSpacePolicies);
    expect(schema.emailSpaceSenderAllowlists).toBe(emailSpaceSenderAllowlists);
    expect(schema.emailConversations).toBe(emailConversations);
    expect(schema.emailBodyObjects).toBe(emailBodyObjects);
    expect(schema.emailLedgerEvents).toBe(emailLedgerEvents);
    expect(schema.emailProviderEvents).toBe(emailProviderEvents);
    expect(schema.emailSesCompatibilityMappings).toBe(
      emailSesCompatibilityMappings,
    );
  });

  it("models the v1 provider, readiness, and ledger vocabularies", () => {
    expect(EMAIL_CHANNEL_PROVIDERS).toEqual(["resend", "ses"]);
    expect(EMAIL_PROVIDER_INSTALL_STATUSES).toEqual([
      "pending",
      "ready",
      "failed",
      "disabled",
    ]);
    expect(EMAIL_READINESS_CHECK_KEYS).toEqual([
      "credentials",
      "sending_domain",
      "inbound_receiving",
      "webhook_signature",
      "provider_events",
      "loop_test",
    ]);
    expect(EMAIL_LEDGER_EVENT_TYPES).toContain("approval_requested");
    expect(EMAIL_LEDGER_EVENT_TYPES).toContain("send_succeeded");
    expect(EMAIL_LEDGER_EVENT_TYPES).toContain("inbound_rejected");
    expect(EMAIL_LEDGER_EVENT_TYPES).toContain("body_redacted");
  });

  it("stores provider credentials by secret reference without exposing raw keys", () => {
    expect(getTableName(emailProviderInstalls)).toBe("email_provider_installs");
    const columns = getTableColumns(emailProviderInstalls);
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.provider.notNull).toBe(true);
    expect(columns.status.default).toBe("pending");
    expect(columns.active_for_production.default).toBe(false);
    expect(columns.credential_secret_ref.notNull).toBe(false);
    expect(columns.webhook_secret_ref.notNull).toBe(false);

    const indexes = getTableConfig(emailProviderInstalls).indexes.map(
      (index) => index.config.name,
    );
    expect(indexes).toContain("uq_email_provider_installs_tenant_provider");
    expect(indexes).toContain("uq_email_provider_installs_active");
  });

  it("keeps readiness checks idempotent at provider and domain scope", () => {
    const columns = getTableColumns(emailReadinessChecks);
    expect(columns.provider_install_id.notNull).toBe(true);
    expect(columns.domain_id.notNull).toBe(false);
    expect(columns.check_key.notNull).toBe(true);
    expect(columns.status.default).toBe("pending");
    expect(migration0170).toContain("uq_email_readiness_check_scope");
    expect(migration0170).toContain("COALESCE(domain_id");
  });

  it("captures Space policy and outside sender allowlists separately", () => {
    const policyColumns = getTableColumns(emailSpacePolicies);
    expect(policyColumns.enabled.default).toBe(false);
    expect(policyColumns.registered_users_allowed.default).toBe(true);
    expect(policyColumns.private_space_membership_required.default).toBe(true);
    expect(policyColumns.first_send_review_required.default).toBe(true);
    expect(policyColumns.outside_sender_default.default).toBe("deny");

    const allowlistColumns = getTableColumns(emailSpaceSenderAllowlists);
    expect(allowlistColumns.value_type.notNull).toBe(true);
    expect(allowlistColumns.value.notNull).toBe(true);
    expect(allowlistColumns.created_by_user_id.notNull).toBe(false);
  });

  it("separates raw body retention from the audit ledger", () => {
    const bodyColumns = getTableColumns(emailBodyObjects);
    expect(bodyColumns.content_hash.notNull).toBe(true);
    expect(bodyColumns.object_ref.notNull).toBe(true);
    expect(bodyColumns.retention_until.notNull).toBe(true);
    expect(bodyColumns.redacted_at.notNull).toBe(false);

    const ledgerColumns = getTableColumns(emailLedgerEvents);
    expect(ledgerColumns.event_type.notNull).toBe(true);
    expect(ledgerColumns.body_object_id.notNull).toBe(false);
    expect(ledgerColumns.metadata.notNull).toBe(true);
    expect(ledgerColumns.to_emails.notNull).toBe(true);
  });

  it("preserves SES reply-token compatibility without changing the legacy table", () => {
    expect(getTableName(emailReplyTokens)).toBe("email_reply_tokens");
    const columns = getTableColumns(emailSesCompatibilityMappings);
    expect(columns.reply_token_id.notNull).toBe(false);
    expect(columns.ses_message_id.notNull).toBe(false);
    expect(columns.legacy_thread_id.notNull).toBe(false);
  });

  it("declares manual migration markers and a reverse-order rollback", () => {
    for (const name of [
      "public.email_provider_installs",
      "public.email_domains",
      "public.email_readiness_checks",
      "public.email_space_policies",
      "public.email_space_sender_allowlists",
      "public.email_conversations",
      "public.email_body_objects",
      "public.email_ledger_events",
      "public.email_provider_events",
      "public.email_ses_compatibility_mappings",
    ]) {
      expect(migration0170).toContain(`-- creates: ${name}`);
      expect(rollback0170).toContain(`DROP TABLE IF EXISTS ${name};`);
    }
  });
});
