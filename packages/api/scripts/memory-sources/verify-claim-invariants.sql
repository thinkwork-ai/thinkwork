-- THINK-193 U2 claim-ledger invariants (Codex backfill verifier).
-- Run against the target stage after any backfill, migration, or dogfood
-- cycle; every column must be ZERO before U2 evidence is accepted.
--
--   psql "$DATABASE_URL" -f scripts/memory-sources/verify-claim-invariants.sql
SELECT
  -- No two ACTIVE claims may share a full value fingerprint.
  (SELECT count(*) FROM (
     SELECT 1 FROM memory_claims WHERE status = 'active'
     GROUP BY tenant_id, target_scope, target_id, subject_key,
              ontology_predicate, value_hash
     HAVING count(*) > 1) t) AS active_identical_duplicates,
  -- Single-valued predicates hold at most one ACTIVE claim per subject.
  (SELECT count(*) FROM (
     SELECT 1 FROM memory_claims
     WHERE status = 'active' AND ontology_predicate IN
       ('customer.name', 'customer.domain', 'customer.employees',
        'customer.annual_recurring_revenue', 'customer.address')
     GROUP BY tenant_id, target_scope, target_id, subject_key,
              ontology_predicate
     HAVING count(*) > 1) t) AS active_single_valued_duplicates,
  -- Superseded/deleted evidence must not count as active support.
  (SELECT count(*) FROM memory_claim_evidence e
     JOIN memory_evidence_items ev ON ev.id = e.evidence_item_id
     WHERE e.status = 'active'
       AND ev.lifecycle <> 'active') AS active_edges_to_nonactive_evidence,
  -- Every ACTIVE claim needs at least one ACTIVE supporting edge.
  (SELECT count(*) FROM memory_claims c
     WHERE c.status = 'active' AND NOT EXISTS (
       SELECT 1 FROM memory_claim_evidence e
       WHERE e.claim_id = c.id
         AND e.status = 'active')) AS active_claims_with_zero_active_support,
  -- Superseded single-valued temporal rows must be CLOSED (effective_to set)
  -- whenever any successor edition (later effective_from, same subject +
  -- predicate) exists; identical-value duplicate editions close zero-length.
  (SELECT count(*) FROM memory_claims c
     WHERE c.status = 'superseded'
       AND c.effective_to IS NULL
       AND c.ontology_predicate IN
         ('customer.name', 'customer.domain', 'customer.employees',
          'customer.annual_recurring_revenue', 'customer.address')
       AND EXISTS (
         SELECT 1 FROM memory_claims n
         WHERE n.tenant_id = c.tenant_id
           AND n.target_scope = c.target_scope
           AND n.target_id = c.target_id
           AND n.subject_key = c.subject_key
           AND n.ontology_predicate = c.ontology_predicate
           AND (n.effective_from > c.effective_from
                OR (n.status = 'active' AND n.value_hash = c.value_hash
                    AND n.effective_from <= c.effective_from))
       )) AS superseded_single_valued_unclosed;
