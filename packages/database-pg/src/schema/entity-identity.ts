/**
 * Canonical entity identity domain tables (THINK-193 U4).
 *
 * Lives in the `identity.*` Postgres schema (greenfield pgSchema per
 * docs/solutions/database-issues/feature-schema-extraction-pattern.md — the
 * compliance-style greenfield variant, no compat views needed).
 *
 * The ontology schema defines the *type system* ("Customer" is a definition);
 * this schema registers the *instances* ("Acme" is a canonical entity). Graph
 * mirror rows, wiki Entity pages, and durable memory claims all point at one
 * stable canonical UUID so renames, merges, and retraction survive slug and
 * label churn.
 *
 * Visibility invariant (plan 2026-07-11-002, "Private identity"): private
 * evidence may REUSE an existing exact mapping internally but never creates
 * tenant-visible mappings, and resolution cases never carry private content
 * — candidates/conflicting_claims jsonb store source-safe identity evidence
 * only.
 *
 * Crosswalk agent routing (THINK-321 U1, plan 2026-07-19-001) adds the
 * user-attribution vocabulary (`created_by='user'` + audit columns on
 * mappings, `revoke`/`split` event types), the negative-evidence store
 * (`mapping_rejections`, KTD-6), the source-system → connector linkage
 * (`source_system_connectors`, KTD-5), the bootstrap/drift match jobs
 * (`match_jobs`, KTD-7), and the in-turn confirm echo-check store
 * (`mapping_candidate_sets`, KTD-2). Constraint widening ships before any
 * writer code.
 */

import {
  pgSchema,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
  foreignKey,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";
import { tenantMcpServers } from "./mcp-servers";

export const identity = pgSchema("identity");

export const CANONICAL_ENTITY_STATUSES = [
  "active",
  "merged",
  "archived",
] as const;
export type CanonicalEntityStatus = (typeof CANONICAL_ENTITY_STATUSES)[number];

export const ENTITY_MAPPING_VISIBILITIES = ["tenant", "private"] as const;
export type EntityMappingVisibility =
  (typeof ENTITY_MAPPING_VISIBILITIES)[number];

/** 'user' = in-turn confirm_mapping attribution (THINK-321). */
export const ENTITY_MAPPING_CREATED_BY = [
  "rule",
  "operator",
  "backfill",
  "user",
] as const;
export type EntityMappingCreatedBy = (typeof ENTITY_MAPPING_CREATED_BY)[number];

/** Append-only audit vocabulary; 'revoke'/'split' landed with THINK-321. */
export const ENTITY_RESOLUTION_EVENT_TYPES = [
  "create",
  "link",
  "defer",
  "reject",
  "merge",
  "revoke",
  "split",
] as const;
export type EntityResolutionEventType =
  (typeof ENTITY_RESOLUTION_EVENT_TYPES)[number];

export const MAPPING_REJECTION_CREATED_BY = [
  "user",
  "operator",
  "rule",
  "system",
] as const;
export type MappingRejectionCreatedBy =
  (typeof MAPPING_REJECTION_CREATED_BY)[number];

export const IDENTITY_MATCH_JOB_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const;
export type IdentityMatchJobStatus =
  (typeof IDENTITY_MATCH_JOB_STATUSES)[number];

export const MAPPING_CANDIDATE_SET_STATUSES = [
  "open",
  "confirmed",
  "declined",
  "superseded",
  "expired",
] as const;
export type MappingCandidateSetStatus =
  (typeof MAPPING_CANDIDATE_SET_STATUSES)[number];

export const ENTITY_IDENTITY_CLAIM_STATES = [
  "active",
  "superseded",
  "rejected",
] as const;
export type EntityIdentityClaimState =
  (typeof ENTITY_IDENTITY_CLAIM_STATES)[number];

export const ENTITY_RESOLUTION_CASE_STATUSES = [
  "open",
  "resolved",
  "expired",
] as const;
export type EntityResolutionCaseStatus =
  (typeof ENTITY_RESOLUTION_CASE_STATUSES)[number];

export const ENTITY_RESOLUTION_DECISIONS = [
  "link",
  "create",
  "defer",
  "reject",
  "merge",
] as const;
export type EntityResolutionDecision =
  (typeof ENTITY_RESOLUTION_DECISIONS)[number];

/** Resolution state stamped on kg.entities rows (U4). */
export const KNOWLEDGE_GRAPH_RESOLUTION_STATES = [
  "resolved",
  "deferred",
  "private",
  "legacy",
] as const;
export type KnowledgeGraphResolutionState =
  (typeof KNOWLEDGE_GRAPH_RESOLUTION_STATES)[number];

// ---------------------------------------------------------------------------
// identity.canonical_entities — the stable instance registry
// ---------------------------------------------------------------------------

export const canonicalEntities = identity.table(
  "canonical_entities",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** Ontology entity-type slug — definitions stay in ontology.entity_types. */
    entity_type_slug: text("entity_type_slug").notNull(),
    display_name: text("display_name").notNull(),
    normalized_name: text("normalized_name").notNull(),
    status: text("status").notNull().default("active"),
    /** Non-null iff status='merged' — the surviving canonical id (redirect). */
    merged_into_id: uuid("merged_into_id").references(
      (): AnyPgColumn => canonicalEntities.id,
      { onDelete: "set null" },
    ),
    version: integer("version").notNull().default(1),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_canonical_entities_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    index("idx_canonical_entities_tenant_type_name").on(
      table.tenant_id,
      table.entity_type_slug,
      table.normalized_name,
    ),
    check(
      "canonical_entities_status_allowed",
      sql`${table.status} IN ('active','merged','archived')`,
    ),
    check(
      "canonical_entities_merged_redirect_required",
      sql`(${table.status} = 'merged') = (${table.merged_into_id} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// identity.entity_source_mappings — exact mapping wins
// ---------------------------------------------------------------------------

export const entitySourceMappings = identity.table(
  "entity_source_mappings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    canonical_entity_id: uuid("canonical_entity_id")
      .references(() => canonicalEntities.id, { onDelete: "cascade" })
      .notNull(),
    /** e.g. 'twenty', 'gmail', 'knowledge_graph', 'wiki'. */
    source_system: text("source_system").notNull(),
    /** Sub-namespace inside the source system (e.g. workspace id). */
    namespace: text("namespace").notNull().default(""),
    external_id: text("external_id").notNull(),
    visibility: text("visibility").notNull().default("tenant"),
    created_by: text("created_by").notNull(),
    /** Set when created_by='user' — the confirming user (server-derived). */
    created_by_user_id: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Audit reference to the thread/turn that produced a user confirm. */
    created_thread_ref: text("created_thread_ref"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Exact mapping wins: one canonical entity per source identity.
    uniqueIndex("uq_entity_source_mappings_source_identity").on(
      table.tenant_id,
      table.source_system,
      table.namespace,
      table.external_id,
    ),
    index("idx_entity_source_mappings_canonical").on(table.canonical_entity_id),
    check(
      "entity_source_mappings_visibility_allowed",
      sql`${table.visibility} IN ('tenant','private')`,
    ),
    check(
      "entity_source_mappings_created_by_allowed",
      sql`${table.created_by} IN ('rule','operator','backfill','user')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// identity.entity_identity_claims — natural-key evidence per canonical entity
// ---------------------------------------------------------------------------

export const entityIdentityClaims = identity.table(
  "entity_identity_claims",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    canonical_entity_id: uuid("canonical_entity_id")
      .references(() => canonicalEntities.id, { onDelete: "cascade" })
      .notNull(),
    /** Identity rule that produced this claim (ontology entity-type rules). */
    rule_slug: text("rule_slug").notNull(),
    rule_version: integer("rule_version").notNull().default(1),
    /** e.g. 'name', 'domain', 'email'. */
    key_kind: text("key_kind").notNull(),
    /** Full normalized natural-key value — data, never B-tree key material. */
    normalized_value: text("normalized_value").notNull(),
    /** sha256 hex of normalized_value — fixed-length lookup material. */
    value_hash: text("value_hash").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    precedence: integer("precedence").notNull().default(0),
    visibility: text("visibility").notNull().default("tenant"),
    state: text("state").notNull().default("active"),
    /** Source-safe evidence refs (evidence item ids, source refs) — no content. */
    evidence: jsonb("evidence")
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
    // Plain lookup index — per-rule uniqueness scope is enforced by the
    // matcher against the approved rule's `unique` flag, NOT one global
    // unique index (rules differ on scope and multiple entities may share a
    // non-unique key like a person name).
    index("idx_entity_identity_claims_lookup").on(
      table.tenant_id,
      table.key_kind,
      table.value_hash,
    ),
    index("idx_entity_identity_claims_canonical").on(table.canonical_entity_id),
    check(
      "entity_identity_claims_visibility_allowed",
      sql`${table.visibility} IN ('tenant','private')`,
    ),
    check(
      "entity_identity_claims_state_allowed",
      sql`${table.state} IN ('active','superseded','rejected')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// identity.entity_resolution_cases — operator ambiguity queue
// ---------------------------------------------------------------------------

export const entityResolutionCases = identity.table(
  "entity_resolution_cases",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** Normalized identity-signature hash — ambiguity coalesces on this. */
    signature_hash: text("signature_hash").notNull(),
    entity_type_slug: text("entity_type_slug").notNull(),
    display_hint: text("display_hint"),
    /** Candidate canonical entities — source-safe fields only, NO private content. */
    candidates: jsonb("candidates")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    conflicting_claims: jsonb("conflicting_claims")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    impact_summary: jsonb("impact_summary")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    item_count: integer("item_count").notNull().default(1),
    status: text("status").notNull().default("open"),
    decision: text("decision"),
    decided_by_user_id: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolved_canonical_entity_id: uuid(
      "resolved_canonical_entity_id",
    ).references(() => canonicalEntities.id, { onDelete: "set null" }),
    decided_at: timestamp("decided_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Ambiguity coalesces: at most one OPEN case per signature per tenant.
    uniqueIndex("uq_entity_resolution_cases_open_signature")
      .on(table.tenant_id, table.signature_hash)
      .where(sql`${table.status} = 'open'`),
    index("idx_entity_resolution_cases_tenant_status_created").on(
      table.tenant_id,
      table.status,
      table.created_at,
    ),
    check(
      "entity_resolution_cases_status_allowed",
      sql`${table.status} IN ('open','resolved','expired')`,
    ),
    check(
      "entity_resolution_cases_decision_allowed",
      sql`${table.decision} IS NULL OR ${table.decision} IN ('link','create','defer','reject','merge')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// identity.entity_resolution_events — append-only audit (revoke/split landed
// with THINK-321; the V1 "no split" restriction is lifted)
// ---------------------------------------------------------------------------

export const entityResolutionEvents = identity.table(
  "entity_resolution_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    case_id: uuid("case_id").references(() => entityResolutionCases.id, {
      onDelete: "set null",
    }),
    canonical_entity_id: uuid("canonical_entity_id").references(
      () => canonicalEntities.id,
      { onDelete: "set null" },
    ),
    event_type: text("event_type").notNull(),
    /** NULL for system-driven events (auto-link, backfill). */
    actor_user_id: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("idx_entity_resolution_events_tenant_created").on(
      table.tenant_id,
      table.created_at,
    ),
    index("idx_entity_resolution_events_case").on(table.case_id),
    check(
      "entity_resolution_events_type_allowed",
      sql`${table.event_type} IN ('create','link','defer','reject','merge','revoke','split')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// identity.graph_projection_cursors — twin projector consumer state
// (Company Brain U5)
// ---------------------------------------------------------------------------

/**
 * Per-tenant cursor over identity.entity_resolution_events for the twin
 * graph projector (Company Brain U5 / KTD-4). The projector is a durable,
 * replayable consumer: a nudge invoke is only a latency optimization — the
 * cursor is the source of truth, so missed nudges are harmless and a full
 * replay from a zeroed cursor converges (graph state derives from current
 * relational rows, not event payloads).
 */
export const identityGraphProjectionCursors = identity.table(
  "graph_projection_cursors",
  {
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .primaryKey(),
    /** created_at of the last processed event. */
    last_event_created_at: timestamp("last_event_created_at", {
      withTimezone: true,
    }),
    /** Tie-breaker id of the last processed event at that timestamp. */
    last_event_id: uuid("last_event_id"),
    /** Snapshot cursor string published with the identity-mapping snapshot. */
    last_snapshot_cursor: text("last_snapshot_cursor"),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
);

// ---------------------------------------------------------------------------
// identity.mapping_rejections — negative evidence (KTD-6)
// ---------------------------------------------------------------------------

/**
 * A rejected (source identity ↔ canonical entity) pairing. Written by revoke
 * and split; honored by the matcher, which demotes a rejected pairing from
 * auto-link to at most a suggestion case.
 */
export const mappingRejections = identity.table(
  "mapping_rejections",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    source_system: text("source_system").notNull(),
    /** Sub-namespace inside the source system (mirrors entity_source_mappings). */
    namespace: text("namespace").notNull().default(""),
    external_id: text("external_id").notNull(),
    canonical_entity_id: uuid("canonical_entity_id")
      .references(() => canonicalEntities.id, { onDelete: "cascade" })
      .notNull(),
    reason: text("reason"),
    created_by: text("created_by").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // One rejection row per (source identity, canonical entity) pairing.
    uniqueIndex("uq_mapping_rejections_pairing").on(
      table.tenant_id,
      table.source_system,
      table.namespace,
      table.external_id,
      table.canonical_entity_id,
    ),
    index("idx_mapping_rejections_tenant_canonical").on(
      table.tenant_id,
      table.canonical_entity_id,
    ),
    check(
      "mapping_rejections_created_by_allowed",
      sql`${table.created_by} IN ('user','operator','rule','system')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// identity.source_system_connectors — source-system → connector linkage (KTD-5)
// ---------------------------------------------------------------------------

/**
 * Links an identity source_system to the tenant connector that can fetch its
 * records. Written at identity-source registration; resolve reads it
 * fail-closed — a mapping is unroutable when the linked connector is absent
 * or not granted to the calling agent.
 *
 * The composite FK rides `uq_tenant_mcp_servers_slug` (a plain unique index
 * on (tenant_id, slug), which Postgres accepts as an FK target). Deleting or
 * renaming a connector cascades so the link never dangles.
 */
export const sourceSystemConnectors = identity.table(
  "source_system_connectors",
  {
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    source_system: text("source_system").notNull(),
    /** tenant_mcp_servers.slug for this tenant. */
    connector_slug: text("connector_slug").notNull(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({
      name: "source_system_connectors_pkey",
      columns: [table.tenant_id, table.source_system],
    }),
    foreignKey({
      name: "source_system_connectors_connector_slug_fk",
      columns: [table.tenant_id, table.connector_slug],
      foreignColumns: [tenantMcpServers.tenant_id, tenantMcpServers.slug],
    })
      .onUpdate("cascade")
      .onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------
// identity.match_jobs — bootstrap/drift identity match jobs (KTD-7)
// ---------------------------------------------------------------------------

/**
 * Mirrors ontology.suggestion_scan_jobs: dedupe-key insert-or-load, async
 * Event invoke of the identity-match Lambda, invoke failure marked on the
 * row. Metrics report scanned / auto-linked / cases-filed / cases-expired so
 * the open-case budget interaction is visible, not silent. Continuation
 * dedupe keys derive from the predecessor's key, never wall-clock.
 */
export const identityMatchJobs = identity.table(
  "match_jobs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    status: text("status").notNull().default("pending"),
    trigger: text("trigger").notNull().default("manual"),
    dedupe_key: text("dedupe_key"),
    /** Source systems this job scans (subset of registered identity sources). */
    source_systems: jsonb("source_systems")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    result: jsonb("result")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    metrics: jsonb("metrics")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    error: text("error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    started_at: timestamp("started_at", { withTimezone: true }),
    finished_at: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    // Insert-or-load dedupe: at most one job per live dedupe key.
    uniqueIndex("uq_identity_match_jobs_dedupe")
      .on(table.tenant_id, table.dedupe_key)
      .where(sql`${table.dedupe_key} IS NOT NULL`),
    index("idx_identity_match_jobs_tenant_status").on(
      table.tenant_id,
      table.status,
    ),
    check(
      "match_jobs_status_allowed",
      sql`${table.status} IN ('pending','running','succeeded','failed')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// identity.mapping_candidate_sets — in-turn confirm echo-check store (KTD-2)
// ---------------------------------------------------------------------------

/**
 * Candidate sets presented to a user via ask_user_question. Lifecycle:
 * written by propose (status='open'), invalidated on confirm/decline/
 * re-propose (confirmed/declined/superseded), and expired rows are refused —
 * confirm_mapping succeeds only when the echoed candidate id matches the
 * recorded selection on an open, unexpired row for the same thread.
 * Candidate payloads are source-safe identity evidence only (data, never
 * instructions).
 */
export const mappingCandidateSets = identity.table(
  "mapping_candidate_sets",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenant_id: uuid("tenant_id")
      .references(() => tenants.id, { onDelete: "cascade" })
      .notNull(),
    /** Thread/turn reference the question was asked in (echo-check scope). */
    thread_ref: text("thread_ref").notNull(),
    source_system: text("source_system").notNull(),
    namespace: text("namespace").notNull().default(""),
    /** The source identity being resolved (source-safe fields only). */
    target_entity_ref:
      jsonb("target_entity_ref").$type<Record<string, unknown>>(),
    /** Candidates as presented, keyed by candidate id. */
    candidates: jsonb("candidates")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("open"),
    /** Recorded at answer intake — confirm_mapping must echo this id. */
    selected_candidate_id: text("selected_candidate_id"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expires_at: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_mapping_candidate_sets_tenant_thread").on(
      table.tenant_id,
      table.thread_ref,
    ),
    check(
      "mapping_candidate_sets_status_allowed",
      sql`${table.status} IN ('open','confirmed','declined','superseded','expired')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const canonicalEntitiesRelations = relations(
  canonicalEntities,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [canonicalEntities.tenant_id],
      references: [tenants.id],
    }),
    mergedInto: one(canonicalEntities, {
      relationName: "canonical_merge_redirect",
      fields: [canonicalEntities.merged_into_id],
      references: [canonicalEntities.id],
    }),
    mergedFrom: many(canonicalEntities, {
      relationName: "canonical_merge_redirect",
    }),
    sourceMappings: many(entitySourceMappings),
    identityClaims: many(entityIdentityClaims),
  }),
);

export const entitySourceMappingsRelations = relations(
  entitySourceMappings,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [entitySourceMappings.tenant_id],
      references: [tenants.id],
    }),
    canonicalEntity: one(canonicalEntities, {
      fields: [entitySourceMappings.canonical_entity_id],
      references: [canonicalEntities.id],
    }),
    createdByUser: one(users, {
      fields: [entitySourceMappings.created_by_user_id],
      references: [users.id],
    }),
  }),
);

export const mappingRejectionsRelations = relations(
  mappingRejections,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [mappingRejections.tenant_id],
      references: [tenants.id],
    }),
    canonicalEntity: one(canonicalEntities, {
      fields: [mappingRejections.canonical_entity_id],
      references: [canonicalEntities.id],
    }),
  }),
);

export const sourceSystemConnectorsRelations = relations(
  sourceSystemConnectors,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [sourceSystemConnectors.tenant_id],
      references: [tenants.id],
    }),
    connector: one(tenantMcpServers, {
      fields: [
        sourceSystemConnectors.tenant_id,
        sourceSystemConnectors.connector_slug,
      ],
      references: [tenantMcpServers.tenant_id, tenantMcpServers.slug],
    }),
  }),
);

export const identityMatchJobsRelations = relations(
  identityMatchJobs,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [identityMatchJobs.tenant_id],
      references: [tenants.id],
    }),
  }),
);

export const mappingCandidateSetsRelations = relations(
  mappingCandidateSets,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [mappingCandidateSets.tenant_id],
      references: [tenants.id],
    }),
  }),
);

export const entityIdentityClaimsRelations = relations(
  entityIdentityClaims,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [entityIdentityClaims.tenant_id],
      references: [tenants.id],
    }),
    canonicalEntity: one(canonicalEntities, {
      fields: [entityIdentityClaims.canonical_entity_id],
      references: [canonicalEntities.id],
    }),
  }),
);

export const entityResolutionCasesRelations = relations(
  entityResolutionCases,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [entityResolutionCases.tenant_id],
      references: [tenants.id],
    }),
    resolvedCanonicalEntity: one(canonicalEntities, {
      fields: [entityResolutionCases.resolved_canonical_entity_id],
      references: [canonicalEntities.id],
    }),
    decidedBy: one(users, {
      fields: [entityResolutionCases.decided_by_user_id],
      references: [users.id],
    }),
    events: many(entityResolutionEvents),
  }),
);

export const entityResolutionEventsRelations = relations(
  entityResolutionEvents,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [entityResolutionEvents.tenant_id],
      references: [tenants.id],
    }),
    case: one(entityResolutionCases, {
      fields: [entityResolutionEvents.case_id],
      references: [entityResolutionCases.id],
    }),
    canonicalEntity: one(canonicalEntities, {
      fields: [entityResolutionEvents.canonical_entity_id],
      references: [canonicalEntities.id],
    }),
    actor: one(users, {
      fields: [entityResolutionEvents.actor_user_id],
      references: [users.id],
    }),
  }),
);
