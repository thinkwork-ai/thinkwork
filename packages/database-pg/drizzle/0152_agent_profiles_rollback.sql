-- Rollback for 0152_agent_profiles.sql.
-- Drops Agent Profile assignment and profile tables.

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0152_agent_profiles'));

DROP TABLE IF EXISTS public.agent_profile_space_assignments;
DROP TABLE IF EXISTS public.agent_profiles;

SELECT pg_advisory_unlock(hashtext('migration:0152_agent_profiles'));
