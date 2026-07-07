-- THINK-155 U3: scheduled-refresh observability on document artifacts.
-- Hand-rolled (db:generate is retired). Stamped only by the run-derived
-- emission path: success sets last_refresh_at and clears refresh_failed_at;
-- a failed scheduled refresh sets refresh_failed_at while the last good
-- finalized head stays in place.
-- creates-column: public.artifacts.last_refresh_at
-- creates-column: public.artifacts.refresh_failed_at

ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS last_refresh_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_failed_at timestamptz;
