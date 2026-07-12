-- THINK-263 R15/KTD-8: search-query telemetry (the flywheel sensor).
-- One append-only row per broker query with per-leg hit counts and statuses.
-- Raw query text is retained as the future wiki-compile demand-queue input;
-- retention policy: rows older than 180 days are eligible for deletion
-- (operational sweep, not enforced in-schema). Operator read paths must be
-- tenant-scoped. Additive — safe to apply ahead of code deploy.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0242_search_queries.sql
-- creates: public.search_queries

CREATE TABLE IF NOT EXISTS public.search_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid,
  query_id uuid,
  query_text text NOT NULL,
  sources jsonb NOT NULL,
  leg_hit_counts jsonb NOT NULL,
  leg_statuses jsonb NOT NULL,
  total_hits integer NOT NULL DEFAULT 0,
  escalated boolean NOT NULL DEFAULT false,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_queries_tenant_created
  ON public.search_queries (tenant_id, created_at DESC);
