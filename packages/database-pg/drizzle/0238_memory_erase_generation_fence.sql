-- THINK-193 U2 (Codex rounds 3-6): erase write-fence, per-generation child
-- scoping, durable bounded-cleanup progress, and DB-level integrity for the
-- retraction saga.
-- Contents:
--   * memory_source_configs.erase_generation — the erase write-fence. Bumped
--     in the SAME transaction that disables the source and persists the
--     durable 'erase' marker (beginSourceErase). Stage writers capture it
--     with the source row; internal writes CAS on it inside their own
--     transaction and external writes (Hindsight upsert, S3 put) check it
--     immediately before AND after the call (with compensation on movement),
--     so an in-flight acquire/project/retain cannot resurrect
--     claims/snapshots/documents after an erase starts.
--   * memory_retraction_attempts.erase_generation — tags 'erase' markers and
--     their 'source'-scoped children with the generation they belong to, so
--     aggregate child accounting never counts dead-lettered children from a
--     PREVIOUS (remediated) erase. Constrained to 0 for derivation-scoped
--     rows.
--   * memory_retraction_attempts.cleanup_phase / cleanup_cursor — durable
--     bounded-cleanup progress on the 'erase' marker (NULL →
--     'snapshots_deleted' → 'evidence_purged'; checkpoints last, then
--     terminal). Closed CHECK domain, valid only on scope='erase'.
--   * Composite accounting index for the per-generation child queries.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0238_memory_erase_generation_fence.sql
-- creates-column: public.memory_source_configs.erase_generation
-- creates-column: public.memory_retraction_attempts.erase_generation
-- creates-column: public.memory_retraction_attempts.cleanup_phase
-- creates-column: public.memory_retraction_attempts.cleanup_cursor
-- creates-constraint: public.memory_source_configs.memory_source_configs_erase_generation_nonnegative
-- creates-constraint: public.memory_retraction_attempts.memory_retraction_attempts_erase_generation_nonnegative
-- creates-constraint: public.memory_retraction_attempts.memory_retraction_attempts_derivation_generation_check
-- creates-constraint: public.memory_retraction_attempts.memory_retraction_attempts_cleanup_phase_check
-- creates: public.memory_retraction_attempts_erase_accounting_idx

ALTER TABLE public.memory_source_configs
  ADD COLUMN IF NOT EXISTS erase_generation integer NOT NULL DEFAULT 0;

ALTER TABLE public.memory_retraction_attempts
  ADD COLUMN IF NOT EXISTS erase_generation integer NOT NULL DEFAULT 0;

ALTER TABLE public.memory_retraction_attempts
  ADD COLUMN IF NOT EXISTS cleanup_phase text;

ALTER TABLE public.memory_retraction_attempts
  ADD COLUMN IF NOT EXISTS cleanup_cursor text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'memory_source_configs_erase_generation_nonnegative'
      AND conrelid = 'public.memory_source_configs'::regclass
  ) THEN
    ALTER TABLE public.memory_source_configs
      ADD CONSTRAINT memory_source_configs_erase_generation_nonnegative
      CHECK (erase_generation >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'memory_retraction_attempts_erase_generation_nonnegative'
      AND conrelid = 'public.memory_retraction_attempts'::regclass
  ) THEN
    ALTER TABLE public.memory_retraction_attempts
      ADD CONSTRAINT memory_retraction_attempts_erase_generation_nonnegative
      CHECK (erase_generation >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'memory_retraction_attempts_derivation_generation_check'
      AND conrelid = 'public.memory_retraction_attempts'::regclass
  ) THEN
    ALTER TABLE public.memory_retraction_attempts
      ADD CONSTRAINT memory_retraction_attempts_derivation_generation_check
      CHECK (scope <> 'derivation' OR erase_generation = 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'memory_retraction_attempts_cleanup_phase_check'
      AND conrelid = 'public.memory_retraction_attempts'::regclass
  ) THEN
    ALTER TABLE public.memory_retraction_attempts
      ADD CONSTRAINT memory_retraction_attempts_cleanup_phase_check
      CHECK (
        cleanup_phase IS NULL
        OR (scope = 'erase'
            AND cleanup_phase IN ('snapshots_deleted', 'evidence_purged'))
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS memory_retraction_attempts_erase_accounting_idx
  ON public.memory_retraction_attempts
    (source_config_id, erase_generation, scope, status);
