-- Archive legacy Python routines (Plan 2026-05-01-008 §U15).
--
-- Phase A introduced an `engine` column on `routines` partitioning rows
-- between `legacy_python` (pre-Phase-A code-backed routines) and
-- `step_functions` (the new ASL substrate). Phase A through D shipped
-- with both engines coexisting so the cutover wouldn't break in-flight
-- legacy routines. Phase E archives the legacy partition.
--
-- Idempotent: re-running on a freshly migrated DB with zero
-- `legacy_python` rows is a no-op. Reversible via the rollback file
-- (status flips back to active for any rows that were active at the
-- time of archival). Capture audit timestamps in routines.updated_at
-- so the migration is observable downstream.
--
-- Pre-flight (dev): 0 routines exist. The migration is purely defensive
-- for prod parity and any future tenant whose legacy_python rows didn't
-- get migrated to ASL during the cutover.
--
-- creates-column: public.routines.archived_at_legacy_cutover

-- Add a marker column so a later "drop the engine column" migration can
-- distinguish "archived because legacy" from "archived for other
-- reasons" (operator action, tenant offboarding). Nullable so existing
-- rows aren't disrupted.
ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS archived_at_legacy_cutover timestamptz;

-- Archive every legacy_python routine that's not already archived.
-- The status flip is the only behavior the v1 admin surface checks
-- (Phase D filter); the marker column is for downstream observability.
UPDATE public.routines
   SET status = 'archived',
       archived_at_legacy_cutover = now(),
       updated_at = now()
 WHERE engine = 'legacy_python'
   AND status <> 'archived';
