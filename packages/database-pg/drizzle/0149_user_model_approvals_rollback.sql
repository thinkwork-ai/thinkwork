-- Rollback for 0149_user_model_approvals.sql.
-- This removes per-user model approval rows and the approval table.

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0149_user_model_approvals:rollback'));

DROP INDEX IF EXISTS public.idx_user_model_approvals_model;
DROP INDEX IF EXISTS public.idx_user_model_approvals_tenant_user;
DROP INDEX IF EXISTS public.uq_user_model_approvals_tenant_user_model;

DROP TABLE IF EXISTS public.user_model_approvals;

SELECT pg_advisory_unlock(hashtext('migration:0149_user_model_approvals:rollback'));
