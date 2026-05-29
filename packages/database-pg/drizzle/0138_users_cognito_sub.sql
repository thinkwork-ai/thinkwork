-- creates-column: public.users.cognito_sub
-- creates: public.idx_users_cognito_sub
--
-- Plan: docs/plans/2026-05-29-006-fix-google-federated-identity-resolution-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0138_users_cognito_sub.sql
--
-- Durable identity link for Google-federated Cognito users. Native users have
-- users.id == Cognito sub; Google-federated users get a fresh-UUID id and were
-- linked only by the optional ID-token `email` claim, so a refreshed token that
-- drops `email` broke identity resolution. Storing the always-present, stable
-- Cognito `sub` here lets resolveCallerFromAuth resolve by sub first
-- (resolvers/core/resolve-auth-user.ts) instead of depending on `email`.
-- Nullable: existing rows have no sub yet (they self-heal via opportunistic
-- backfill, and bootstrapUser stamps it for new users). Postgres treats NULLs
-- as distinct in a unique index, so many un-backfilled rows coexist.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS cognito_sub text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cognito_sub
  ON public.users (cognito_sub);

COMMIT;
