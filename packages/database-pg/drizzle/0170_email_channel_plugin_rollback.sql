-- Rollback: remove provider-neutral Email Channel plugin state.
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0170_email_channel_plugin_rollback.sql

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP TABLE IF EXISTS public.email_ses_compatibility_mappings;
DROP TABLE IF EXISTS public.email_provider_events;
DROP TABLE IF EXISTS public.email_ledger_events;
DROP TABLE IF EXISTS public.email_body_objects;
DROP TABLE IF EXISTS public.email_conversations;
DROP TABLE IF EXISTS public.email_space_sender_allowlists;
DROP TABLE IF EXISTS public.email_space_policies;
DROP TABLE IF EXISTS public.email_readiness_checks;
DROP TABLE IF EXISTS public.email_domains;
DROP TABLE IF EXISTS public.email_provider_installs;

COMMIT;
