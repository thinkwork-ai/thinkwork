-- Purpose: add tenant-scoped business ontology definitions, suggestion change sets, and reprocess job state.
-- Plan: docs/plans/2026-05-17-002-feat-business-ontology-change-sets-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0098_business_ontology.sql
-- creates: ontology
-- creates: ontology.versions
-- creates: ontology.entity_types
-- creates: ontology.relationship_types
-- creates: ontology.facet_templates
-- creates: ontology.external_mappings
-- creates: ontology.change_sets
-- creates: ontology.change_set_items
-- creates: ontology.evidence_examples
-- creates: ontology.suggestion_scan_jobs
-- creates: ontology.reprocess_jobs
-- creates: ontology.uq_ontology_versions_tenant_version
-- creates: ontology.uq_ontology_versions_tenant_active
-- creates: ontology.uq_ontology_entity_types_tenant_slug
-- creates: ontology.uq_ontology_relationship_types_tenant_slug
-- creates: ontology.uq_ontology_facet_templates_entity_slug
-- creates: ontology.uq_ontology_external_mappings_subject_uri
-- creates: ontology.uq_ontology_suggestion_scan_jobs_dedupe
-- creates: ontology.uq_ontology_reprocess_jobs_dedupe
-- creates-constraint: ontology.versions.ontology_versions_tenant_id_tenants_id_fk
-- creates-constraint: ontology.versions.ontology_versions_status_allowed
-- creates-constraint: ontology.entity_types.ontology_entity_types_lifecycle_allowed
-- creates-constraint: ontology.relationship_types.ontology_relationship_types_lifecycle_allowed
-- creates-constraint: ontology.external_mappings.ontology_external_mappings_kind_allowed
-- creates-constraint: ontology.change_sets.ontology_change_sets_status_allowed
-- creates-constraint: ontology.suggestion_scan_jobs.ontology_suggestion_scan_jobs_status_allowed
-- creates-constraint: ontology.reprocess_jobs.ontology_reprocess_jobs_status_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE SCHEMA IF NOT EXISTS ontology;

CREATE TABLE IF NOT EXISTS ontology.versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  version_number integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source_change_set_id uuid,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ontology_versions_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_versions_status_allowed
    CHECK (status IN ('active', 'superseded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_versions_tenant_version
  ON ontology.versions (tenant_id, version_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_versions_tenant_active
  ON ontology.versions (tenant_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_ontology_versions_tenant_created
  ON ontology.versions (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS ontology.entity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  version_id uuid,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  broad_type text NOT NULL DEFAULT 'entity',
  aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  properties_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  guidance_notes text,
  lifecycle_status text NOT NULL DEFAULT 'proposed',
  proposed_by_user_id uuid,
  approved_by_user_id uuid,
  approved_at timestamptz,
  deprecated_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ontology_entity_types_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_entity_types_version_id_versions_id_fk
    FOREIGN KEY (version_id)
    REFERENCES ontology.versions(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_entity_types_proposed_by_user_id_users_id_fk
    FOREIGN KEY (proposed_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_entity_types_approved_by_user_id_users_id_fk
    FOREIGN KEY (approved_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_entity_types_lifecycle_allowed
    CHECK (lifecycle_status IN ('proposed', 'approved', 'deprecated', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_entity_types_tenant_slug
  ON ontology.entity_types (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_ontology_entity_types_tenant_status
  ON ontology.entity_types (tenant_id, lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_ontology_entity_types_broad_type
  ON ontology.entity_types (broad_type);

CREATE TABLE IF NOT EXISTS ontology.relationship_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  version_id uuid,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  inverse_name text,
  source_entity_type_id uuid,
  target_entity_type_id uuid,
  source_type_slugs text[] NOT NULL DEFAULT ARRAY[]::text[],
  target_type_slugs text[] NOT NULL DEFAULT ARRAY[]::text[],
  aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  guidance_notes text,
  lifecycle_status text NOT NULL DEFAULT 'proposed',
  proposed_by_user_id uuid,
  approved_by_user_id uuid,
  approved_at timestamptz,
  deprecated_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ontology_relationship_types_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_relationship_types_version_id_versions_id_fk
    FOREIGN KEY (version_id)
    REFERENCES ontology.versions(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_relationship_types_source_entity_type_id_fk
    FOREIGN KEY (source_entity_type_id)
    REFERENCES ontology.entity_types(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_relationship_types_target_entity_type_id_fk
    FOREIGN KEY (target_entity_type_id)
    REFERENCES ontology.entity_types(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_relationship_types_proposed_by_user_id_users_id_fk
    FOREIGN KEY (proposed_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_relationship_types_approved_by_user_id_users_id_fk
    FOREIGN KEY (approved_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_relationship_types_lifecycle_allowed
    CHECK (lifecycle_status IN ('proposed', 'approved', 'deprecated', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_relationship_types_tenant_slug
  ON ontology.relationship_types (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_ontology_relationship_types_tenant_status
  ON ontology.relationship_types (tenant_id, lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_ontology_relationship_types_source
  ON ontology.relationship_types (source_entity_type_id);

CREATE INDEX IF NOT EXISTS idx_ontology_relationship_types_target
  ON ontology.relationship_types (target_entity_type_id);

CREATE TABLE IF NOT EXISTS ontology.facet_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_type_id uuid NOT NULL,
  slug text NOT NULL,
  heading text NOT NULL,
  facet_type text NOT NULL DEFAULT 'compiled',
  position integer NOT NULL DEFAULT 0,
  source_priority jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt text,
  guidance_notes text,
  lifecycle_status text NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ontology_facet_templates_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_facet_templates_entity_type_id_entity_types_id_fk
    FOREIGN KEY (entity_type_id)
    REFERENCES ontology.entity_types(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_facet_templates_lifecycle_allowed
    CHECK (lifecycle_status IN ('proposed', 'approved', 'deprecated', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_facet_templates_entity_slug
  ON ontology.facet_templates (entity_type_id, slug);

CREATE INDEX IF NOT EXISTS idx_ontology_facet_templates_tenant
  ON ontology.facet_templates (tenant_id);

CREATE TABLE IF NOT EXISTS ontology.external_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subject_kind text NOT NULL,
  subject_id uuid NOT NULL,
  mapping_kind text NOT NULL,
  vocabulary text NOT NULL,
  external_uri text NOT NULL,
  external_label text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ontology_external_mappings_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_external_mappings_subject_allowed
    CHECK (subject_kind IN ('entity_type', 'relationship_type', 'facet_template')),
  CONSTRAINT ontology_external_mappings_kind_allowed
    CHECK (mapping_kind IN ('exact', 'close', 'broad', 'narrow', 'related'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_external_mappings_subject_uri
  ON ontology.external_mappings (subject_kind, subject_id, vocabulary, external_uri);

CREATE INDEX IF NOT EXISTS idx_ontology_external_mappings_tenant_kind
  ON ontology.external_mappings (tenant_id, subject_kind);

CREATE TABLE IF NOT EXISTS ontology.change_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title text NOT NULL,
  summary text,
  status text NOT NULL DEFAULT 'draft',
  confidence numeric(5, 4),
  observed_frequency integer NOT NULL DEFAULT 0,
  expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_by text NOT NULL DEFAULT 'suggestion_engine',
  proposed_by_user_id uuid,
  approved_by_user_id uuid,
  approved_at timestamptz,
  rejected_by_user_id uuid,
  rejected_at timestamptz,
  applied_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ontology_change_sets_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_change_sets_proposed_by_user_id_users_id_fk
    FOREIGN KEY (proposed_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_change_sets_approved_by_user_id_users_id_fk
    FOREIGN KEY (approved_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_change_sets_rejected_by_user_id_users_id_fk
    FOREIGN KEY (rejected_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_change_sets_applied_version_id_versions_id_fk
    FOREIGN KEY (applied_version_id)
    REFERENCES ontology.versions(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_change_sets_status_allowed
    CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'applied'))
);

CREATE INDEX IF NOT EXISTS idx_ontology_change_sets_tenant_status
  ON ontology.change_sets (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_ontology_change_sets_applied_version
  ON ontology.change_sets (applied_version_id);

CREATE TABLE IF NOT EXISTS ontology.change_set_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  change_set_id uuid NOT NULL,
  item_type text NOT NULL,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review',
  target_kind text,
  target_slug text,
  title text NOT NULL,
  description text,
  proposed_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  edited_value jsonb,
  confidence numeric(5, 4),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ontology_change_set_items_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_change_set_items_change_set_id_change_sets_id_fk
    FOREIGN KEY (change_set_id)
    REFERENCES ontology.change_sets(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_change_set_items_type_allowed
    CHECK (item_type IN ('entity_type', 'relationship_type', 'facet_template', 'external_mapping')),
  CONSTRAINT ontology_change_set_items_action_allowed
    CHECK (action IN ('create', 'update', 'deprecate', 'reject')),
  CONSTRAINT ontology_change_set_items_status_allowed
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'applied'))
);

CREATE INDEX IF NOT EXISTS idx_ontology_change_set_items_change_set
  ON ontology.change_set_items (change_set_id);

CREATE INDEX IF NOT EXISTS idx_ontology_change_set_items_tenant_status
  ON ontology.change_set_items (tenant_id, status);

CREATE TABLE IF NOT EXISTS ontology.evidence_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  change_set_id uuid NOT NULL,
  item_id uuid,
  source_kind text NOT NULL,
  source_ref text,
  source_label text,
  quote text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ontology_evidence_examples_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_evidence_examples_change_set_id_change_sets_id_fk
    FOREIGN KEY (change_set_id)
    REFERENCES ontology.change_sets(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_evidence_examples_item_id_change_set_items_id_fk
    FOREIGN KEY (item_id)
    REFERENCES ontology.change_set_items(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ontology_evidence_change_set
  ON ontology.evidence_examples (change_set_id);

CREATE INDEX IF NOT EXISTS idx_ontology_evidence_item
  ON ontology.evidence_examples (item_id);

CREATE INDEX IF NOT EXISTS idx_ontology_evidence_tenant_source
  ON ontology.evidence_examples (tenant_id, source_kind);

CREATE TABLE IF NOT EXISTS ontology.suggestion_scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  trigger text NOT NULL DEFAULT 'manual',
  dedupe_key text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ontology_suggestion_scan_jobs_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_suggestion_scan_jobs_status_allowed
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'canceled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_suggestion_scan_jobs_dedupe
  ON ontology.suggestion_scan_jobs (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ontology_suggestion_scan_jobs_tenant_status
  ON ontology.suggestion_scan_jobs (tenant_id, status);

CREATE TABLE IF NOT EXISTS ontology.reprocess_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  change_set_id uuid,
  ontology_version_id uuid,
  dedupe_key text,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ontology_reprocess_jobs_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT ontology_reprocess_jobs_change_set_id_change_sets_id_fk
    FOREIGN KEY (change_set_id)
    REFERENCES ontology.change_sets(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_reprocess_jobs_ontology_version_id_versions_id_fk
    FOREIGN KEY (ontology_version_id)
    REFERENCES ontology.versions(id)
    ON DELETE SET NULL,
  CONSTRAINT ontology_reprocess_jobs_status_allowed
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'canceled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_reprocess_jobs_dedupe
  ON ontology.reprocess_jobs (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ontology_reprocess_jobs_tenant_status
  ON ontology.reprocess_jobs (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_ontology_reprocess_jobs_change_set
  ON ontology.reprocess_jobs (change_set_id);

INSERT INTO ontology.versions (tenant_id, version_number, status, activated_at)
SELECT tenants.id, 1, 'active', now()
FROM public.tenants
ON CONFLICT (tenant_id, version_number) DO NOTHING;

WITH seed(slug, name, broad_type, description, guidance_notes, aliases) AS (
  VALUES
    ('customer', 'Customer', 'organization', 'An account, buyer, prospect, or commercial organization the company serves.', 'Compile customer pages from relationship, opportunity, commitment, risk, support, and recent activity evidence.', ARRAY['account', 'client', 'buyer']::text[]),
    ('person', 'Person', 'person', 'A human stakeholder connected to a customer, partner, vendor, or internal initiative.', 'Use only business-relevant facts and relationship context.', ARRAY['contact', 'stakeholder']::text[]),
    ('opportunity', 'Opportunity', 'commercial_event', 'A potential or active revenue motion with a customer or prospect.', 'Track stage, mutual plan, blockers, next steps, and linked people.', ARRAY['deal', 'pipeline item']::text[]),
    ('order', 'Order', 'commercial_record', 'A committed transaction, purchase order, subscription, or contract record.', 'Prefer source-system facts over conversational inference.', ARRAY['contract', 'purchase']::text[]),
    ('support_case', 'Support Case', 'service_record', 'A customer issue, escalation, defect, or help request.', 'Compile active symptoms, owner, severity, customer impact, and resolution trail.', ARRAY['ticket', 'case', 'escalation']::text[]),
    ('commitment', 'Commitment', 'promise', 'A promise, follow-up, delivery obligation, or action item owed by or to the company.', 'Capture owner, due date, recipient, current status, and source evidence.', ARRAY['promise', 'follow up', 'action item']::text[]),
    ('risk', 'Risk', 'risk', 'A business risk, objection, blocker, competitor threat, or delivery concern.', 'Separate observed evidence from speculative impact.', ARRAY['blocker', 'concern', 'threat']::text[]),
    ('decision', 'Decision', 'decision', 'A durable decision with rationale, tradeoffs, and affected business objects.', 'Prefer the most recent explicit decision evidence and preserve rationale.', ARRAY['choice', 'approval']::text[])
)
INSERT INTO ontology.entity_types (
  tenant_id,
  version_id,
  slug,
  name,
  broad_type,
  description,
  guidance_notes,
  aliases,
  lifecycle_status,
  approved_at
)
SELECT
  tenants.id,
  versions.id,
  seed.slug,
  seed.name,
  seed.broad_type,
  seed.description,
  seed.guidance_notes,
  seed.aliases,
  'approved',
  now()
FROM public.tenants
JOIN ontology.versions
  ON versions.tenant_id = tenants.id
  AND versions.version_number = 1
CROSS JOIN seed
ON CONFLICT (tenant_id, slug) DO NOTHING;

WITH seed(slug, name, inverse_name, source_slug, target_slug, description, source_type_slugs, target_type_slugs) AS (
  VALUES
    ('has_stakeholder', 'Has stakeholder', 'Stakeholder of', 'customer', 'person', 'Connects a customer or opportunity to an involved person.', ARRAY['customer', 'opportunity']::text[], ARRAY['person']::text[]),
    ('has_opportunity', 'Has opportunity', 'Opportunity for', 'customer', 'opportunity', 'Connects a customer or prospect to a revenue opportunity.', ARRAY['customer']::text[], ARRAY['opportunity']::text[]),
    ('has_commitment', 'Has commitment', 'Commitment for', 'customer', 'commitment', 'Connects an entity to a promise, follow-up, or obligation.', ARRAY['customer', 'opportunity', 'support_case']::text[], ARRAY['commitment']::text[]),
    ('has_risk', 'Has risk', 'Risk for', 'customer', 'risk', 'Connects an entity to a business risk or blocker.', ARRAY['customer', 'opportunity', 'support_case']::text[], ARRAY['risk']::text[]),
    ('has_support_case', 'Has support case', 'Support case for', 'customer', 'support_case', 'Connects a customer to active or historical support work.', ARRAY['customer']::text[], ARRAY['support_case']::text[])
)
INSERT INTO ontology.relationship_types (
  tenant_id,
  version_id,
  slug,
  name,
  inverse_name,
  source_entity_type_id,
  target_entity_type_id,
  source_type_slugs,
  target_type_slugs,
  description,
  lifecycle_status,
  approved_at
)
SELECT
  source_type.tenant_id,
  source_type.version_id,
  seed.slug,
  seed.name,
  seed.inverse_name,
  source_type.id,
  target_type.id,
  seed.source_type_slugs,
  seed.target_type_slugs,
  seed.description,
  'approved',
  now()
FROM seed
JOIN ontology.entity_types source_type
  ON source_type.slug = seed.source_slug
JOIN ontology.entity_types target_type
  ON target_type.tenant_id = source_type.tenant_id
  AND target_type.slug = seed.target_slug
ON CONFLICT (tenant_id, slug) DO NOTHING;

WITH seed(entity_slug, slug, heading, facet_type, position, prompt) AS (
  VALUES
    ('customer', 'overview', 'Overview', 'compiled', 10, 'Summarize the customer, relationship state, and current business context.'),
    ('customer', 'stakeholders', 'Stakeholders', 'relationship', 20, 'List the important people, roles, sentiment, and relationship notes.'),
    ('customer', 'opportunities', 'Opportunities', 'operational', 30, 'Summarize open and recently changed opportunities.'),
    ('customer', 'commitments', 'Commitments', 'operational', 40, 'Track promises, owners, due dates, and fulfillment status.'),
    ('customer', 'risks', 'Risks', 'operational', 50, 'Capture blockers, objections, delivery risks, and escalation signals.'),
    ('opportunity', 'overview', 'Overview', 'compiled', 10, 'Summarize business outcome, stage, buyer context, and next milestone.'),
    ('opportunity', 'mutual_plan', 'Mutual Plan', 'operational', 20, 'Capture milestones, responsibilities, dates, and open dependencies.'),
    ('support_case', 'overview', 'Overview', 'compiled', 10, 'Summarize customer impact, status, owner, and latest update.'),
    ('commitment', 'status', 'Status', 'operational', 10, 'Capture owner, recipient, due date, evidence, and completion state.'),
    ('risk', 'assessment', 'Assessment', 'compiled', 10, 'Separate risk evidence, likelihood, impact, mitigation, and owner.')
)
INSERT INTO ontology.facet_templates (
  tenant_id,
  entity_type_id,
  slug,
  heading,
  facet_type,
  position,
  prompt,
  lifecycle_status
)
SELECT
  entity_types.tenant_id,
  entity_types.id,
  seed.slug,
  seed.heading,
  seed.facet_type,
  seed.position,
  seed.prompt,
  'approved'
FROM seed
JOIN ontology.entity_types
  ON entity_types.slug = seed.entity_slug
ON CONFLICT (entity_type_id, slug) DO NOTHING;

WITH seed(entity_slug, mapping_kind, vocabulary, external_uri, external_label, notes) AS (
  VALUES
    ('customer', 'broad', 'schema.org', 'https://schema.org/Organization', 'Organization', 'Customer is tenant-specific and can include prospects or accounts, so this mapping stays broad.'),
    ('person', 'close', 'schema.org', 'https://schema.org/Person', 'Person', 'Business person records may omit personal details by policy.'),
    ('opportunity', 'related', 'schema.org', 'https://schema.org/Offer', 'Offer', 'Opportunity is a sales-process object, not a public offer.'),
    ('order', 'close', 'schema.org', 'https://schema.org/Order', 'Order', 'Commercial order records should prefer source-system identifiers.'),
    ('decision', 'related', 'prov-o', 'http://www.w3.org/ns/prov#Activity', 'Activity', 'Decisions are durable outcomes with provenance, not generic activities.')
)
INSERT INTO ontology.external_mappings (
  tenant_id,
  subject_kind,
  subject_id,
  mapping_kind,
  vocabulary,
  external_uri,
  external_label,
  notes
)
SELECT
  entity_types.tenant_id,
  'entity_type',
  entity_types.id,
  seed.mapping_kind,
  seed.vocabulary,
  seed.external_uri,
  seed.external_label,
  seed.notes
FROM seed
JOIN ontology.entity_types
  ON entity_types.slug = seed.entity_slug
ON CONFLICT (subject_kind, subject_id, vocabulary, external_uri) DO NOTHING;

COMMIT;
