-- Purpose: normalize tenant_members.principal_type to lowercase and prevent
-- future drift. Two writers (inviteMember mutation, REST POST /tenants/:id/invite)
-- wrote 'USER' (uppercase) while every reader gate filters on 'user' (lowercase).
-- The mismatch made invited users invisible to canReadTenantSpaces /
-- requester-context / auth-me role / etc. — the public/private space change
-- exposed it because invited users still saw nothing after spaces were
-- marked public.
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0118_normalize_tenant_member_principal_type.sql
-- creates-constraint: public.tenant_members.tenant_members_principal_type_lowercase_chk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Backfill existing rows. tenant_members is small (< 1000 rows in any
-- realistic tenant), so a plain UPDATE under the statement_timeout is safe.
UPDATE public.tenant_members
   SET principal_type = lower(principal_type)
 WHERE principal_type <> lower(principal_type);

-- Lock the canonical shape so neither writer (nor any future one) can
-- reintroduce the case mismatch silently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'tenant_members_principal_type_lowercase_chk'
       AND conrelid = 'public.tenant_members'::regclass
  ) THEN
    ALTER TABLE public.tenant_members
      ADD CONSTRAINT tenant_members_principal_type_lowercase_chk
      CHECK (principal_type = lower(principal_type));
  END IF;
END;
$$;

COMMIT;
