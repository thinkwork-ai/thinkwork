-- 0229_analyst_reader_rds_iam_grant.sql
--
-- THINK-229 U1 (R1, KTD2): switch analyst_reader to RDS IAM authentication.
--
-- `GRANT rds_iam TO analyst_reader` flips the role to IAM-token login:
-- AWS-documented semantics are that password authentication STOPS WORKING
-- for the role the moment this membership exists. Apply ordering therefore
-- matters (KTD2 dual-path):
--
--   1. Broker code with IAM-first-with-password-fallback deploys first
--      (packages/lambda/analyst-reader-db.ts) and the Terraform env/IAM
--      wiring (ANALYST_DB_CLUSTER_ENDPOINT + rds-db:connect grant +
--      iam_database_authentication_enabled on the cluster) is live.
--   2. THEN this migration applies to dev via psql (before its PR merges,
--      per the drift-gate convention). Pre-grant, IAM connect fails and
--      the password carries; post-grant, password fails and IAM carries.
--      No coordinated flip, no outage window.
--
-- Pre-apply gate (run first — do NOT apply while the cluster flag is
-- pending, or password auth dies while IAM auth is still refused):
--   aws rds describe-db-clusters --db-cluster-identifier thinkwork-<stage>-db \
--     --query 'DBClusters[0].[IAMDatabaseAuthenticationEnabled, PendingModifiedValues]'
--   → must show `true` and no pending IAM-auth modification.
--
-- Rollback: REVOKE rds_iam FROM analyst_reader (restores password login;
-- the fallback path in the broker picks it up on the next reconnect).
--
-- The rds_iam role is provided by RDS/Aurora Postgres on every cluster —
-- guarded anyway so a non-RDS local Postgres apply fails loudly with a
-- clear message instead of a bare undefined-role error.
--
-- This membership is the single allowlisted exception to 0227's
-- zero-membership assertion (SET ROLE escalation surface): rds_iam is a
-- marker role carrying no privileges to inherit (and analyst_reader is
-- NOINHERIT besides).
--
-- Apply manually (hand-rolled — NOT in meta/_journal.json):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0229_analyst_reader_rds_iam_grant.sql
--
-- creates-role-membership: rds_iam:analyst_reader

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rds_iam') THEN
    RAISE EXCEPTION 'role rds_iam does not exist — this migration targets RDS/Aurora Postgres only';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analyst_reader') THEN
    RAISE EXCEPTION 'role analyst_reader does not exist — apply drizzle/0227_analyst_reader_role.sql first';
  END IF;
END $$;

GRANT rds_iam TO analyst_reader;

-- Assert the membership surface is EXACTLY {rds_iam} — the same posture as
-- 0227's assert, with the single deliberate exception.
DO $$
DECLARE
  unexpected text;
BEGIN
  SELECT string_agg(r.rolname, ', ') INTO unexpected
  FROM pg_auth_members m
  JOIN pg_roles r ON r.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE member.rolname = 'analyst_reader'
    AND r.rolname <> 'rds_iam';
  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'analyst_reader holds memberships beyond rds_iam: %', unexpected;
  END IF;
END $$;

COMMIT;
