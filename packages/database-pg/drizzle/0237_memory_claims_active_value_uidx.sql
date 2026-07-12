-- THINK-193 U2 (Codex concurrency finding): structural backstop against
-- duplicate ACTIVE same-value claims. upsertClaimsForEvidence serializes
-- writers with a per-subject transaction-scoped advisory lock; this partial
-- unique index guarantees the invariant even if a future caller bypasses
-- the lock. Superseded/retracted rows keep full temporal history (a value
-- may recur later as a NEW active edition — only one can be active).
--
-- Codex round-5/6 P1: a bare CREATE UNIQUE INDEX cannot upgrade a database
-- that already contains the duplicates the index forbids, and repair +
-- index creation must be ATOMIC against concurrent writers. The whole file
-- is ONE explicit transaction that write-locks memory_claims and
-- memory_claim_evidence before scanning:
--   1. ABORT loudly if any active duplicate group has the same value_hash
--      but DIFFERENT full JSON values (sha256 collision — human decision).
--   2. Per duplicate group, keep the EARLIEST row (created_at, id). Edge
--      merge is PAIR-SAFE: first materialize the DISTINCT
--      (keeper, evidence) pairs implied by all loser ACTIVE edges, then
--      ensure exactly ONE ACTIVE keeper edge per pair (reactivating a
--      pre-existing retracted keeper edge, inserting otherwise — never
--      violating the (claim_id, evidence_item_id) pair unique), then
--      retract all loser edges. Finally close the losers as 'superseded'
--      with the duplicate-edition interval policy: zero-length at their own
--      effective_from when the keeper is earlier-or-equal (NULL keeper
--      counts as earliest), else closed at the keeper's effective_from; a
--      NULL result falls back to now() so every ended interval is closed.
--   3. Assert zero remaining active duplicates (RAISE rolls the whole
--      transaction back).
-- Re-running is idempotent: with no duplicates the repair is a no-op and
-- the index CREATE is IF NOT EXISTS.
--
-- Hand-rolled (partial index + repair; drizzle-kit cannot express it).
-- Apply with:
--   psql "$DATABASE_URL" -f drizzle/0237_memory_claims_active_value_uidx.sql
-- creates: public.memory_claims_active_value_uidx

BEGIN;

LOCK TABLE public.memory_claims IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.memory_claim_evidence IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  collision_groups integer;
  remaining_duplicates integer;
BEGIN
  -- 1. Same hash, different value: refuse to merge automatically.
  SELECT count(*) INTO collision_groups FROM (
    SELECT 1
    FROM memory_claims
    WHERE status = 'active'
    GROUP BY tenant_id, target_scope, target_id, subject_key,
             ontology_predicate, value_hash
    HAVING count(*) > 1 AND count(DISTINCT value::text) > 1
  ) t;
  IF collision_groups > 0 THEN
    RAISE EXCEPTION
      'memory_claims: % active duplicate group(s) share value_hash with DIFFERING values (hash collision) — resolve manually before applying 0237',
      collision_groups;
  END IF;

  -- 2. Deterministic repair of identical-value active duplicates.
  CREATE TEMP TABLE _mc_active_dupe_losers ON COMMIT DROP AS
  SELECT id,
         keeper_id,
         keeper_effective_from,
         effective_from AS own_effective_from
  FROM (
    SELECT id,
           effective_from,
           first_value(id) OVER w AS keeper_id,
           first_value(effective_from) OVER w AS keeper_effective_from,
           row_number() OVER w AS rn
    FROM memory_claims
    WHERE status = 'active'
    WINDOW w AS (
      PARTITION BY tenant_id, target_scope, target_id, subject_key,
                   ontology_predicate, value_hash
      ORDER BY created_at, id
    )
  ) ranked
  WHERE rn > 1;

  -- 2a. Materialize the DISTINCT (keeper, evidence) pairs implied by loser
  --     ACTIVE edges — several losers sharing one evidence item collapse to
  --     one target pair, so the merge can never violate the
  --     (claim_id, evidence_item_id) pair unique.
  CREATE TEMP TABLE _mc_keeper_pairs ON COMMIT DROP AS
  SELECT DISTINCT ON (l.keeper_id, e.evidence_item_id)
         l.keeper_id,
         e.evidence_item_id,
         e.tenant_id,
         e.source_config_id
  FROM memory_claim_evidence e
  JOIN _mc_active_dupe_losers l ON l.id = e.claim_id
  WHERE e.status = 'active';

  -- 2b. Reactivate a pre-existing (possibly retracted) keeper edge for each
  --     pair — the keeper must end with ACTIVE support wherever a loser had
  --     it.
  UPDATE memory_claim_evidence k
  SET status = 'active', retracted_at = NULL
  FROM _mc_keeper_pairs p
  WHERE k.claim_id = p.keeper_id
    AND k.evidence_item_id = p.evidence_item_id
    AND k.status <> 'active';

  -- 2c. Insert the keeper edges that do not exist at all.
  INSERT INTO memory_claim_evidence
    (tenant_id, claim_id, evidence_item_id, source_config_id, status)
  SELECT p.tenant_id, p.keeper_id, p.evidence_item_id, p.source_config_id,
         'active'
  FROM _mc_keeper_pairs p
  WHERE NOT EXISTS (
    SELECT 1 FROM memory_claim_evidence k
    WHERE k.claim_id = p.keeper_id
      AND k.evidence_item_id = p.evidence_item_id
  );

  -- 2d. Retract ALL loser active edges (their support now lives on the
  --     keeper).
  UPDATE memory_claim_evidence e
  SET status = 'retracted', retracted_at = now()
  FROM _mc_active_dupe_losers l
  WHERE e.claim_id = l.id
    AND e.status = 'active';

  -- 2e. Close and supersede the losers (duplicate-edition interval policy).
  UPDATE memory_claims c
  SET status = 'superseded',
      effective_to = COALESCE(
        c.effective_to,
        CASE
          WHEN l.keeper_effective_from IS NULL
            OR (l.own_effective_from IS NOT NULL
                AND l.keeper_effective_from <= l.own_effective_from)
            THEN l.own_effective_from
          ELSE l.keeper_effective_from
        END,
        now()
      ),
      updated_at = now()
  FROM _mc_active_dupe_losers l
  WHERE c.id = l.id;

  -- 3. The invariant must hold before the index lands.
  SELECT count(*) INTO remaining_duplicates FROM (
    SELECT 1
    FROM memory_claims
    WHERE status = 'active'
    GROUP BY tenant_id, target_scope, target_id, subject_key,
             ontology_predicate, value_hash
    HAVING count(*) > 1
  ) t;
  IF remaining_duplicates > 0 THEN
    RAISE EXCEPTION
      'memory_claims duplicate repair left % active duplicate group(s) — aborting index creation',
      remaining_duplicates;
  END IF;
END $$;

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

COMMIT;
