-- Purpose: materialization suggestions (Company Brain U8 / R8) — when a
--   cohort question needs a limited/unclonable facet, the gap surfaces to
--   operators on the ontology surface as a persisted, deduped, dismissible
--   suggestion with a hit counter (one row per tenant + entity type + facet).
-- Plan: docs/plans/2026-07-21-001-feat-company-brain-digital-twin-plan.md (U8)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0273_twin_materialization_suggestions.sql
-- creates: public.twin_materialization_suggestions

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.twin_materialization_suggestions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    entity_type_slug TEXT        NOT NULL,
    facet_slug       TEXT        NOT NULL,
    hit_count        INTEGER     NOT NULL DEFAULT 1,
    last_question    TEXT,
    dismissed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, entity_type_slug, facet_slug)
);

COMMIT;
