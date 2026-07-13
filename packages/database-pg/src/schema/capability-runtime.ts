/**
 * Governed capability runtime persistence (THINK-280 U1).
 *
 * Immutable definition/version records, service-principal identity,
 * per-version credential bindings, research/admission and Routine proposals,
 * and append-only broker evidence. The shared semantics (descriptor shape,
 * taxonomies, fingerprints, twcap references) live in
 * `@thinkwork/capability-contracts`; these tables persist those payloads
 * without reinterpreting them.
 *
 * Immutability rules enforced by migration 0247 triggers + app logic:
 *   - an `admitted` capability_definition_versions row never updates; a
 *     refresh creates a new `candidate` version
 *   - proposals and broker-call rows are append-only (status transitions
 *     only through the allowed columns)
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core.js";

// ---------------------------------------------------------------------------
// tenant_service_principals — stable, revocable non-human identity
// ---------------------------------------------------------------------------

export const tenantServicePrincipals = pgTable(
  "tenant_service_principals",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** URL-safe display identifier, unique per tenant. */
    slug: text("slug").notNull(),
    display_name: text("display_name").notNull(),
    /** What this principal exists for — shown on grants/bindings/evidence. */
    purpose: text("purpose"),
    /** 'active' | 'revoked'. CHECK-constrained in migration 0247. */
    status: text("status").notNull().default("active"),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    revoked_by_user_id: uuid("revoked_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    metadata_json: jsonb("metadata_json").notNull().default({}),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_tenant_service_principals_tenant_slug").on(
      table.tenant_id,
      table.slug,
    ),
    index("idx_tenant_service_principals_tenant").on(table.tenant_id),
  ],
);

// ---------------------------------------------------------------------------
// capability_definitions — stable logical definition identity
// ---------------------------------------------------------------------------

export const capabilityDefinitions = pgTable(
  "capability_definitions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /**
     * Tenant scope. NULL = platform-scoped definition visible to every
     * tenant's admission flow (reference contracts, not auto-granted).
     */
    tenant_id: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    /** twcap namespace segment ('platform' or the tenant slug at creation). */
    namespace: text("namespace").notNull(),
    /** twcap class segment, e.g. 'connection'. */
    class: text("class").notNull(),
    /** twcap slug segment. Provider grouping is display-only — GitHub REST and GitHub MCP stay distinct definitions. */
    slug: text("slug").notNull(),
    display_name: text("display_name").notNull(),
    /** 'active' | 'retired'. CHECK-constrained in migration 0247. */
    status: text("status").notNull().default("active"),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
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
    uniqueIndex("uq_capability_definitions_identity").on(
      table.namespace,
      table.class,
      table.slug,
    ),
    index("idx_capability_definitions_tenant").on(table.tenant_id),
  ],
);

// ---------------------------------------------------------------------------
// capability_definition_versions — append-only admitted/candidate versions
// ---------------------------------------------------------------------------

export const capabilityDefinitionVersions = pgTable(
  "capability_definition_versions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    definition_id: uuid("definition_id")
      .references(() => capabilityDefinitions.id, { onDelete: "cascade" })
      .notNull(),
    /** Monotonic decimal version — the twcap version segment. */
    version: integer("version").notNull(),
    /**
     * The full canonical descriptor payload (CapabilityDescriptor shape from
     * @thinkwork/capability-contracts) exactly as fingerprinted/signed.
     * Never mutated after admission — refresh creates a new candidate row.
     */
    descriptor_json: jsonb("descriptor_json").notNull(),
    /** RFC 8785 + SHA-256 fingerprint of descriptor_json (hex). */
    descriptor_fingerprint: text("descriptor_fingerprint").notNull(),
    /**
     * Per-operation contract hashes: { [operationId]: sha256hex }. Searchable
     * projection of the signed contracts inside descriptor_json.
     */
    contract_hashes_json: jsonb("contract_hashes_json").notNull(),
    /** Ed25519 signature envelope over the canonical descriptor bytes. */
    signature_json: jsonb("signature_json"),
    /** 'candidate' | 'admitted' | 'rejected' | 'retired'. CHECK in 0247. */
    lifecycle: text("lifecycle").notNull().default("candidate"),
    /** Official-source provenance + research evidence references. */
    provenance_json: jsonb("provenance_json").notNull().default({}),
    /** Proposal that produced this version, when research-driven. */
    source_proposal_id: uuid("source_proposal_id"),
    admitted_at: timestamp("admitted_at", { withTimezone: true }),
    admitted_by_user_id: uuid("admitted_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_capability_definition_versions_def_version").on(
      table.definition_id,
      table.version,
    ),
    index("idx_capability_definition_versions_def").on(table.definition_id),
    index("idx_capability_definition_versions_fingerprint").on(
      table.descriptor_fingerprint,
    ),
  ],
);

// ---------------------------------------------------------------------------
// capability_credential_bindings — per-version, per-principal readiness
// ---------------------------------------------------------------------------

export const capabilityCredentialBindings = pgTable(
  "capability_credential_bindings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    definition_version_id: uuid("definition_version_id")
      .references(() => capabilityDefinitionVersions.id, {
        onDelete: "cascade",
      })
      .notNull(),
    /**
     * Exactly one explicit principal mode and subject (R6): 'requester' and
     * 'agent_owner' resolve users at action time; 'service' resolves a
     * tenant service principal. No fallback across modes.
     */
    principal_mode: text("principal_mode").notNull(),
    /** Subject for 'service' mode. NULL for user-resolving modes. */
    service_principal_id: uuid("service_principal_id").references(
      () => tenantServicePrincipals.id,
      { onDelete: "restrict" },
    ),
    /** Subject for user-pinned bindings (a specific requester/agent-owner user). */
    subject_user_id: uuid("subject_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /**
     * Secret fields are vault references (tenant_credentials ids / secret
     * refs) — never secret material. Shape: { [credentialKind]: ref }.
     */
    credential_refs_json: jsonb("credential_refs_json").notNull().default({}),
    /** 'pending_setup' | 'verifying' | 'ready' | 'degraded' | 'revoked'. CHECK in 0247. */
    readiness: text("readiness").notNull().default("pending_setup"),
    /** Redacted, version-specific probe evidence (never raw provider bodies). */
    readiness_evidence_json: jsonb("readiness_evidence_json")
      .notNull()
      .default({}),
    last_verified_at: timestamp("last_verified_at", { withTimezone: true }),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
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
    index("idx_capability_credential_bindings_tenant").on(table.tenant_id),
    index("idx_capability_credential_bindings_version").on(
      table.definition_version_id,
    ),
    uniqueIndex("uq_capability_credential_bindings_subject").on(
      table.definition_version_id,
      table.principal_mode,
      table.service_principal_id,
      table.subject_user_id,
    ),
  ],
);

// ---------------------------------------------------------------------------
// capability_external_clients — operator-created confidential M2M clients
// ---------------------------------------------------------------------------

export const capabilityExternalClients = pgTable(
  "capability_external_clients",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** OAuth client_id issued to the external host. */
    client_id: text("client_id").notNull(),
    /** Slow hash of the one-time-revealed client secret — never plaintext. */
    client_secret_hash: text("client_secret_hash").notNull(),
    /** Exactly one active service principal this client acts as. */
    service_principal_id: uuid("service_principal_id")
      .references(() => tenantServicePrincipals.id, { onDelete: "restrict" })
      .notNull(),
    /** Exact allowed MCP resource + scope (v1: capabilities resource, capabilities:search). */
    allowed_resource: text("allowed_resource").notNull(),
    allowed_scopes_json: jsonb("allowed_scopes_json").notNull().default([]),
    /** 'active' | 'revoked'. CHECK-constrained in migration 0247. */
    status: text("status").notNull().default("active"),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    rotated_at: timestamp("rotated_at", { withTimezone: true }),
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
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
    uniqueIndex("uq_capability_external_clients_client_id").on(table.client_id),
    index("idx_capability_external_clients_tenant").on(table.tenant_id),
  ],
);

// ---------------------------------------------------------------------------
// capability_connection_proposals — immutable research/admission proposals
// ---------------------------------------------------------------------------

export const capabilityConnectionProposals = pgTable(
  "capability_connection_proposals",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** Target logical definition when refreshing; NULL for a new Connection. */
    definition_id: uuid("definition_id").references(
      () => capabilityDefinitions.id,
      { onDelete: "set null" },
    ),
    /** Immutable proposed descriptor + research payload. Non-executable evidence. */
    payload_json: jsonb("payload_json").notNull(),
    /** RFC 8785 + SHA-256 fingerprint of payload_json — approval binds to it. */
    payload_fingerprint: text("payload_fingerprint").notNull(),
    /** Official-source URLs + cached provenance references with expiry. */
    provenance_json: jsonb("provenance_json").notNull().default({}),
    /** 'draft' | 'submitted' | 'admitted' | 'rejected' | 'superseded'. CHECK in 0247. */
    status: text("status").notNull().default("draft"),
    /** Inbox item id — a link to the human decision, never the decision itself. */
    inbox_item_id: uuid("inbox_item_id"),
    /** Generic actor provenance (agent/user/system) for the proposer. */
    created_by_actor_type: text("created_by_actor_type"),
    created_by_actor_id: uuid("created_by_actor_id"),
    decided_at: timestamp("decided_at", { withTimezone: true }),
    decided_by_user_id: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_capability_connection_proposals_tenant").on(table.tenant_id),
    index("idx_capability_connection_proposals_definition").on(
      table.definition_id,
    ),
    index("idx_capability_connection_proposals_status").on(
      table.tenant_id,
      table.status,
    ),
  ],
);

// ---------------------------------------------------------------------------
// capability_routine_proposals — immutable Routine promotion proposals (U6)
// ---------------------------------------------------------------------------

export const capabilityRoutineProposals = pgTable(
  "capability_routine_proposals",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** Target Routine when updating an existing one; NULL for a new Routine. */
    routine_id: uuid("routine_id"),
    /**
     * Immutable proposal bundle: normalized code, typed input/output,
     * sanitized fixtures, invariants, exact dependency references (twcap +
     * contract hashes), minimum grants, principal spec, and
     * effect/data/cost summary. Fixtures pass the routine-output-redactor
     * scrub before this row is written.
     */
    payload_json: jsonb("payload_json").notNull(),
    /** RFC 8785 + SHA-256 fingerprint — approval consumes exactly one. */
    payload_fingerprint: text("payload_fingerprint").notNull(),
    /** Source broker call / turn evidence references. */
    evidence_refs_json: jsonb("evidence_refs_json").notNull().default([]),
    /**
     * 'draft' | 'submitted' | 'approved' | 'rejected' | 'superseded' |
     * 'promoted'. CHECK in 0247. Any payload edit creates a NEW proposal row
     * with a new fingerprint; the old approval is invalid by construction.
     */
    status: text("status").notNull().default("draft"),
    inbox_item_id: uuid("inbox_item_id"),
    /**
     * 'operator' | 'repair'. Repair auto-publish is the sole machine-approved
     * exception to the exact-approval rule (R14/AE6) and is recorded with its
     * structured-field diff + green fixture evidence in approval_evidence_json.
     */
    approval_mode: text("approval_mode"),
    approval_evidence_json: jsonb("approval_evidence_json")
      .notNull()
      .default({}),
    created_by_actor_type: text("created_by_actor_type"),
    created_by_actor_id: uuid("created_by_actor_id"),
    decided_at: timestamp("decided_at", { withTimezone: true }),
    decided_by_user_id: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Git commit SHA written by promotion; NULL until promoted. */
    promoted_commit_sha: text("promoted_commit_sha"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_capability_routine_proposals_tenant").on(table.tenant_id),
    index("idx_capability_routine_proposals_routine").on(table.routine_id),
    index("idx_capability_routine_proposals_status").on(
      table.tenant_id,
      table.status,
    ),
  ],
);

// ---------------------------------------------------------------------------
// capability_broker_sessions — durable session evidence (live state = DynamoDB)
// ---------------------------------------------------------------------------

export const capabilityBrokerSessions = pgTable(
  "capability_broker_sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** Broker session id (the DynamoDB partition identity). */
    session_id: text("session_id").notNull(),
    /** Audience the session is bound to (broker endpoint identity). */
    audience: text("audience").notNull(),
    /** Invocation projection/manifest fingerprint the session was minted from. */
    context_fingerprint: text("context_fingerprint").notNull(),
    principal_mode: text("principal_mode").notNull(),
    service_principal_id: uuid("service_principal_id").references(
      () => tenantServicePrincipals.id,
      { onDelete: "set null" },
    ),
    subject_user_id: uuid("subject_user_id"),
    /** Exact grant/contract snapshot references at mint (upper bound, not cached authz). */
    grant_snapshot_json: jsonb("grant_snapshot_json").notNull().default({}),
    budgets_json: jsonb("budgets_json").notNull().default({}),
    /** Loose run/turn linkage — plain uuids, not FKs (append-only evidence). */
    routine_execution_id: uuid("routine_execution_id"),
    thread_turn_id: uuid("thread_turn_id"),
    /** 'active' | 'expired' | 'cancelled' | 'closed'. CHECK in 0247. */
    status: text("status").notNull().default("active"),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    closed_at: timestamp("closed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_capability_broker_sessions_session_id").on(
      table.session_id,
    ),
    index("idx_capability_broker_sessions_tenant").on(table.tenant_id),
    index("idx_capability_broker_sessions_created").on(
      table.tenant_id,
      table.created_at,
    ),
  ],
);

// ---------------------------------------------------------------------------
// capability_broker_calls — append-only broker call evidence
// ---------------------------------------------------------------------------

export const capabilityBrokerCalls = pgTable(
  "capability_broker_calls",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    broker_session_id: uuid("broker_session_id")
      .references(() => capabilityBrokerSessions.id, { onDelete: "cascade" })
      .notNull(),
    /** Session-unique client request id (lost-response status lookups key on it). */
    client_request_id: text("client_request_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }),
    /** Exact twcap operation reference (string form; structured fields in *_json). */
    operation_ref: text("operation_ref"),
    contract_hash: text("contract_hash"),
    definition_version_id: uuid("definition_version_id").references(
      () => capabilityDefinitionVersions.id,
      { onDelete: "set null" },
    ),
    binding_id: uuid("binding_id").references(
      () => capabilityCredentialBindings.id,
      { onDelete: "set null" },
    ),
    /**
     * 'rejected' | 'authorized' | 'completed' | 'accepted' | 'failed' |
     * 'indeterminate'. CHECK in 0247. Written 'authorized' before dispatch;
     * finalized after. A failed terminal update leaves 'indeterminate' for
     * operator reconciliation — never automatic redispatch.
     */
    status: text("status").notNull(),
    /** Policy decision trail (grants/readiness/approval/budget/effect gates). */
    policy_decisions_json: jsonb("policy_decisions_json").notNull().default({}),
    /** Safe request/result digests — never secret material or unbounded bodies. */
    request_digest: text("request_digest"),
    result_digest: text("result_digest"),
    error_category: text("error_category"),
    effect: text("effect"),
    budget_delta_json: jsonb("budget_delta_json").notNull().default({}),
    adapter_kind: text("adapter_kind"),
    duration_ms: integer("duration_ms"),
    /** Durable output reference (artifact/s3) when the result exceeded inline cap. */
    durable_ref_json: jsonb("durable_ref_json"),
    /** Loose linkage — plain uuids, not FKs (append-only evidence). */
    routine_execution_id: uuid("routine_execution_id"),
    thread_turn_id: uuid("thread_turn_id"),
    compliance_event_id: uuid("compliance_event_id"),
    authorized_at: timestamp("authorized_at", { withTimezone: true }),
    finalized_at: timestamp("finalized_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("uq_capability_broker_calls_session_request").on(
      table.broker_session_id,
      table.client_request_id,
    ),
    index("idx_capability_broker_calls_tenant").on(table.tenant_id),
    index("idx_capability_broker_calls_session").on(table.broker_session_id),
    index("idx_capability_broker_calls_routine_exec").on(
      table.routine_execution_id,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const capabilityDefinitionsRelations = relations(
  capabilityDefinitions,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [capabilityDefinitions.tenant_id],
      references: [tenants.id],
    }),
    versions: many(capabilityDefinitionVersions),
  }),
);

export const capabilityDefinitionVersionsRelations = relations(
  capabilityDefinitionVersions,
  ({ one, many }) => ({
    definition: one(capabilityDefinitions, {
      fields: [capabilityDefinitionVersions.definition_id],
      references: [capabilityDefinitions.id],
    }),
    bindings: many(capabilityCredentialBindings),
  }),
);

export const capabilityCredentialBindingsRelations = relations(
  capabilityCredentialBindings,
  ({ one }) => ({
    definitionVersion: one(capabilityDefinitionVersions, {
      fields: [capabilityCredentialBindings.definition_version_id],
      references: [capabilityDefinitionVersions.id],
    }),
    servicePrincipal: one(tenantServicePrincipals, {
      fields: [capabilityCredentialBindings.service_principal_id],
      references: [tenantServicePrincipals.id],
    }),
  }),
);

export const capabilityBrokerCallsRelations = relations(
  capabilityBrokerCalls,
  ({ one }) => ({
    session: one(capabilityBrokerSessions, {
      fields: [capabilityBrokerCalls.broker_session_id],
      references: [capabilityBrokerSessions.id],
    }),
  }),
);
