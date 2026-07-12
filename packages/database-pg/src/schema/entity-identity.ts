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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { tenants, users } from "./core";

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

export const ENTITY_MAPPING_CREATED_BY = [
  "rule",
  "operator",
  "backfill",
] as const;
export type EntityMappingCreatedBy = (typeof ENTITY_MAPPING_CREATED_BY)[number];

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

/** Resolution state stamped on knowledge_graph_entities rows (U4). */
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
      sql`${table.created_by} IN ('rule','operator','backfill')`,
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
    index("idx_entity_identity_claims_canonical").on(
      table.canonical_entity_id,
    ),
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
// identity.entity_resolution_events — append-only audit (NO split in V1)
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
      sql`${table.event_type} IN ('create','link','defer','reject','merge')`,
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
