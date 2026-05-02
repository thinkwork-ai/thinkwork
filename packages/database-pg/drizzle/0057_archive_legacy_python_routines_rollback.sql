-- Rollback for 0057_archive_legacy_python_routines.sql (Plan 2026-05-01-008 §U15).
--
-- Restores the previous status only for rows we archived in this
-- migration (identified by archived_at_legacy_cutover IS NOT NULL).
-- Operator-archived rows or other-cutover archives are not touched.
--
-- Post-rollback: `archived_at_legacy_cutover` column is dropped.

UPDATE public.routines
   SET status = 'active',
       updated_at = now()
 WHERE engine = 'legacy_python'
   AND status = 'archived'
   AND archived_at_legacy_cutover IS NOT NULL;

ALTER TABLE public.routines DROP COLUMN IF EXISTS archived_at_legacy_cutover;
