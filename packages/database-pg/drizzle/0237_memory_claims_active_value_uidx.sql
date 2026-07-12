-- THINK-193 U2 (Codex concurrency finding): structural backstop against
-- duplicate ACTIVE same-value claims. upsertClaimsForEvidence serializes
-- writers with a per-subject transaction-scoped advisory lock; this partial
-- unique index guarantees the invariant even if a future caller bypasses
-- the lock. Superseded/retracted rows keep full temporal history (a value
-- may recur later as a NEW active edition — only one can be active).
--
-- Hand-rolled (partial index; drizzle-kit cannot express it). Apply with:
--   psql "$DATABASE_URL" -f drizzle/0237_memory_claims_active_value_uidx.sql
-- creates: public.memory_claims_active_value_uidx

CREATE UNIQUE INDEX IF NOT EXISTS memory_claims_active_value_uidx
  ON public.memory_claims (
    tenant_id,
    target_scope,
    target_id,
    subject_key,
    ontology_predicate,
    value_hash
  )
  WHERE status = 'active';
