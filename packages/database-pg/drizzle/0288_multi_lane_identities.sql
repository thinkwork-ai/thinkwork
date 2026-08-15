-- Multi-lane identity enrollment (Eric 2026-08-15: "I need all three" —
-- email, Google AND Microsoft sign-in for one person).
--
-- uq_user_auth_identities_cognito_sub allowed ONE enrollment per Cognito
-- subject, total. But a Cognito user with linked providers carries one sub
-- across lanes (password + Microsoft on the same sub), so whichever lane
-- enrolled first consumed the slot and every other lane admitted to
-- "No tenant assigned". Admission already matches per-connection
-- (auth-admission.ts: identity.authProviderResourceId === route.connectionId);
-- the index was the only thing forcing one lane per person.
--
-- One row per (subject, connection) from now on. The invariant that one
-- Cognito subject maps to ONE product user is no longer carried by this
-- index — the writers enforce it (cross-user guard in auto-link, enrollment
-- consume, and invite).
--
-- Hand-rolled (mirrors the 0274..0287 convention; not registered in
-- meta/_journal.json).
-- Apply via: psql "$DATABASE_URL" -f drizzle/0288_multi_lane_identities.sql
-- drops: public.uq_user_auth_identities_cognito_sub
-- creates: public.uq_user_auth_identities_sub_connection

DROP INDEX IF EXISTS public.uq_user_auth_identities_cognito_sub;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_auth_identities_sub_connection
  ON public.user_auth_identities (cognito_issuer, cognito_sub, auth_provider_resource_id);
