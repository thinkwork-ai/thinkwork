import type {
  emailBodyObjects,
  emailConversations,
  emailDomains,
  emailLedgerEvents,
  emailProviderEvents,
  emailProviderInstalls,
  emailReadinessChecks,
  emailSpacePolicies,
  emailSpaceSenderAllowlists,
} from "@thinkwork/database-pg/schema";

export function dbEnumToGraphql(value: unknown): string {
  return String(value ?? "").toUpperCase();
}

export function graphqlEnumToDb(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

export function graphqlJsonInput(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || value === "") return {};
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) return parsed;
    throw new Error("AWSJSON input must be an object");
  }
  if (isRecord(value)) return value;
  throw new Error("AWSJSON input must be an object");
}

export function isoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

type ProviderRow = typeof emailProviderInstalls.$inferSelect;
type DomainRow = typeof emailDomains.$inferSelect;
type ReadinessRow = typeof emailReadinessChecks.$inferSelect;
type SpacePolicyRow = typeof emailSpacePolicies.$inferSelect;
type AllowlistRow = typeof emailSpaceSenderAllowlists.$inferSelect;
type ConversationRow = typeof emailConversations.$inferSelect;
type BodyObjectRow = typeof emailBodyObjects.$inferSelect;
type LedgerRow = typeof emailLedgerEvents.$inferSelect;
type ProviderEventRow = typeof emailProviderEvents.$inferSelect;

export function emailProviderInstallPayload(row: ProviderRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: dbEnumToGraphql(row.provider),
    displayName: row.display_name,
    status: dbEnumToGraphql(row.status),
    activeForProduction: row.active_for_production,
    credentialConfigured: Boolean(row.credential_secret_ref),
    webhookSecretConfigured: Boolean(row.webhook_secret_ref),
    defaultFromEmail: row.default_from_email,
    metadata: JSON.stringify(row.metadata ?? {}),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}

export function emailDomainPayload(row: DomainRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    providerInstallId: row.provider_install_id,
    domain: row.domain,
    ownershipType: dbEnumToGraphql(row.ownership_type),
    status: dbEnumToGraphql(row.status),
    sendingVerifiedAt: isoDate(row.sending_verified_at),
    inboundVerifiedAt: isoDate(row.inbound_verified_at),
    dnsRecords: JSON.stringify(row.dns_records ?? {}),
    providerMetadata: JSON.stringify(row.provider_metadata ?? {}),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}

export function emailReadinessCheckPayload(row: ReadinessRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    providerInstallId: row.provider_install_id,
    domainId: row.domain_id,
    checkKey: dbEnumToGraphql(row.check_key),
    status: dbEnumToGraphql(row.status),
    lastCheckedAt: isoDate(row.last_checked_at),
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    metadata: JSON.stringify(row.metadata ?? {}),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}

export function emailSpacePolicyPayload(
  row: SpacePolicyRow,
  allowlists: AllowlistRow[] = [],
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    spaceId: row.space_id,
    providerInstallId: row.provider_install_id,
    enabled: row.enabled,
    registeredUsersAllowed: row.registered_users_allowed,
    privateSpaceMembershipRequired: row.private_space_membership_required,
    outsideSenderDefault: row.outside_sender_default,
    firstSendReviewRequired: row.first_send_review_required,
    policy: JSON.stringify(row.policy ?? {}),
    allowlists: allowlists.map(emailSpaceSenderAllowlistPayload),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}

export function emailSpaceSenderAllowlistPayload(row: AllowlistRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    spaceId: row.space_id,
    valueType: dbEnumToGraphql(row.value_type),
    value: row.value,
    reason: row.reason,
    createdByUserId: row.created_by_user_id,
    createdAt: isoDate(row.created_at),
  };
}

export function emailConversationPayload(row: ConversationRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    spaceId: row.space_id,
    threadId: row.thread_id,
    providerInstallId: row.provider_install_id,
    subject: row.subject,
    status: dbEnumToGraphql(row.status),
    approvedAt: isoDate(row.approved_at),
    approvedByUserId: row.approved_by_user_id,
    lastMessageAt: isoDate(row.last_message_at),
    participantHash: row.participant_hash,
    metadata: JSON.stringify(row.metadata ?? {}),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  };
}

export function emailBodyObjectPayload(row: BodyObjectRow | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    direction: dbEnumToGraphql(row.direction),
    contentHash: row.content_hash,
    retentionUntil: isoDate(row.retention_until),
    redactedAt: isoDate(row.redacted_at),
    redactedByUserId: row.redacted_by_user_id,
    redactionReason: row.redaction_reason,
    metadata: JSON.stringify(row.metadata ?? {}),
    createdAt: isoDate(row.created_at),
  };
}

export function emailLedgerEventPayload(
  row: LedgerRow,
  bodyObject?: BodyObjectRow | null,
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    spaceId: row.space_id,
    threadId: row.thread_id,
    messageId: row.message_id,
    inboxItemId: row.inbox_item_id,
    providerInstallId: row.provider_install_id,
    eventType: dbEnumToGraphql(row.event_type),
    providerMessageId: row.provider_message_id,
    providerEventId: row.provider_event_id,
    actorUserId: row.actor_user_id,
    bodyObject: emailBodyObjectPayload(bodyObject),
    subject: row.subject,
    fromEmail: row.from_email,
    toEmails: Array.isArray(row.to_emails) ? row.to_emails : [],
    reasonCode: row.reason_code,
    metadata: JSON.stringify(row.metadata ?? {}),
    createdAt: isoDate(row.created_at),
  };
}

export function emailProviderEventPayload(row: ProviderEventRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    providerInstallId: row.provider_install_id,
    ledgerEventId: row.ledger_event_id,
    providerEventId: row.provider_event_id,
    providerMessageId: row.provider_message_id,
    eventType: dbEnumToGraphql(row.event_type),
    occurredAt: isoDate(row.occurred_at),
    payloadMetadata: JSON.stringify(row.payload_metadata ?? {}),
    createdAt: isoDate(row.created_at),
  };
}

export function normalizeDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/^@+/, "");
  if (!domain) {
    throw new Error("Domain must be non-empty");
  }
  return domain;
}

export function normalizeEmailOrDomain(
  valueType: string,
  value: string,
): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Allowlist value must be non-empty");
  }
  return valueType === "domain" ? normalized.replace(/^@+/, "") : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
