-- THINK-193 U6: personal (user-scoped) external-memory evidence + claims.
-- The Gmail email tracer writes evidence and claims into the owner's User
-- Bank (target_scope 'user'); the U1/U2 CHECK constraints only allowed the
-- shared scopes. Replace both constraints with _v2 versions that include
-- 'user'. Shared-only surfaces stay guarded in code (SharedTargetScope,
-- graph/wiki hard-reject user_* banks).
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0240_memory_personal_scope.sql
-- creates-constraint: public.memory_evidence_items.memory_evidence_items_target_scope_check_v2
-- drops-constraint: public.memory_evidence_items.memory_evidence_items_target_scope_check
-- creates-constraint: public.memory_claims.memory_claims_target_scope_check_v2
-- drops-constraint: public.memory_claims.memory_claims_target_scope_check

ALTER TABLE public.memory_evidence_items
  DROP CONSTRAINT IF EXISTS memory_evidence_items_target_scope_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'memory_evidence_items_target_scope_check_v2'
      AND conrelid = 'public.memory_evidence_items'::regclass
  ) THEN
    ALTER TABLE public.memory_evidence_items
      ADD CONSTRAINT memory_evidence_items_target_scope_check_v2
      CHECK (target_scope IN ('user', 'space', 'tenant'));
  END IF;
END $$;

ALTER TABLE public.memory_claims
  DROP CONSTRAINT IF EXISTS memory_claims_target_scope_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'memory_claims_target_scope_check_v2'
      AND conrelid = 'public.memory_claims'::regclass
  ) THEN
    ALTER TABLE public.memory_claims
      ADD CONSTRAINT memory_claims_target_scope_check_v2
      CHECK (target_scope IN ('user', 'space', 'tenant'));
  END IF;
END $$;
