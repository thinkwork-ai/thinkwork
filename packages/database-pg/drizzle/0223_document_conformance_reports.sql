-- THINK-189 U2: per-emission document conformance reports.
-- One row per successful emission on a manifest-bearing plate: deterministic
-- structural facts recorded at the emission seam, judge columns filled
-- asynchronously by the conformance judge sweeper. Rows append as a corpus
-- (never head-rewritten). Additive — safe to apply ahead of code deploy.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0223_document_conformance_reports.sql
-- creates: public.document_conformance_reports

CREATE TABLE IF NOT EXISTS public.document_conformance_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  plate_slug text NOT NULL,
  document_status text NOT NULL,
  digest_revision text NOT NULL,
  manifest_snapshot jsonb NOT NULL,
  sections jsonb NOT NULL,
  analyses jsonb NOT NULL,
  judge_status text NOT NULL DEFAULT 'pending',
  judge_attempts integer NOT NULL DEFAULT 0,
  judge_model text,
  judge_findings jsonb,
  judge_completed_at timestamptz,
  judge_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_conformance_reports_judge_status_check
    CHECK (judge_status IN ('pending', 'complete', 'error', 'skipped'))
);

CREATE INDEX IF NOT EXISTS document_conformance_reports_tenant_plate_created_idx
  ON public.document_conformance_reports (tenant_id, plate_slug, created_at);

-- Sweeper scan: pending rows only, oldest first.
CREATE INDEX IF NOT EXISTS document_conformance_reports_judge_pending_idx
  ON public.document_conformance_reports (created_at)
  WHERE judge_status = 'pending';
