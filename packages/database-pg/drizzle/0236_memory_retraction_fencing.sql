-- THINK-193 U2 (Codex P1/P2 merge blockers): retraction saga worker fencing
-- and durable source-erase aggregate markers.
-- Contents:
--   * memory_retraction_attempts.lock_generation — fencing token; every CAS
--     claim increments it and all saga transitions (recordProgress /
--     finalizeInternalState / markRetracted / markFailed) CAS on
--     (locked_by, lock_generation) so a worker reclaimed past a stale lease
--     can never clobber the newer claimant's progress.
--   * memory_retraction_attempts.reconsolidation_note — non-null when the
--     reconsolidation step was skipped (delete-capable adapter without a
--     consolidator): durable skipped-with-reason, distinct from success.
--   * scope CHECK v2 — adds 'erase': one durable aggregate marker row per
--     source erase (synthetic erase:<sourceConfigId> document id under the
--     existing partial unique document index). Markers are excluded from the
--     per-document saga; the scheduled memory-retraction-drainer keys its
--     self-finalizing cleanup sweep (S3 snapshot prefix -> evidence purge ->
--     checkpoints LAST) on them, covering sources with zero derivations.
--     NEW constraint name: the drift reporter probes by name only.
--
-- No status CHECK changes: the status value set is unchanged; only the
-- saga's transition ORDER moved (provider delete now precedes the internal
-- finalize transaction).
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0236_memory_retraction_fencing.sql
-- creates-column: public.memory_retraction_attempts.lock_generation
-- creates-column: public.memory_retraction_attempts.reconsolidation_note
-- creates-constraint: public.memory_retraction_attempts.memory_retraction_attempts_scope_check_v2

ALTER TABLE public.memory_retraction_attempts
  ADD COLUMN IF NOT EXISTS lock_generation integer NOT NULL DEFAULT 0;

ALTER TABLE public.memory_retraction_attempts
  ADD COLUMN IF NOT EXISTS reconsolidation_note text;

ALTER TABLE public.memory_retraction_attempts
  DROP CONSTRAINT IF EXISTS memory_retraction_attempts_scope_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'memory_retraction_attempts_scope_check_v2'
      AND conrelid = 'public.memory_retraction_attempts'::regclass
  ) THEN
    ALTER TABLE public.memory_retraction_attempts
      ADD CONSTRAINT memory_retraction_attempts_scope_check_v2
      CHECK (scope IN ('derivation', 'source', 'erase'));
  END IF;
END $$;
