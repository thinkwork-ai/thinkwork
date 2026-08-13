-- Brain-pool subject on Brain principals (THINK-625 backfill gap) — the
-- write side of the `subject` field in user-claims/v1.
--
-- The manifest published `users.cognito_sub` as `subject`, but that column
-- is the user's sub in THIS product's Cognito pool. The Brain MCP has its
-- OWN end-user pool, and a federated (Google/Microsoft) sign-in there mints
-- a DIFFERENT sub — so the published subject never matched the Brain access
-- token, claims resolution fell closed to emptyGrants(), and an HR user's
-- payroll ask was refused (TEI, 2026-08-12). Access tokens carry no email
-- claim, so the reader's email fallback cannot save the mismatch.
--
-- This column holds the sub the user's Brain tokens actually carry. It is
-- captured at the ONE place the product ever sees a Brain token: the
-- mcp-oauth callback (skills.ts), which decodes the access token it just
-- exchanged and republishes the manifest. The manifest publisher prefers
-- brain_subject over users.cognito_sub; NULL (never captured) keeps
-- today's fallback byte-identical.
--
-- Hand-rolled (mirrors the 0274/0281/0282/0284/0285/0286 convention; not
-- registered in meta/_journal.json).
-- Apply via: psql "$DATABASE_URL" -f drizzle/0287_brain_subject.sql
-- creates-column: public.user_brain_claims.brain_subject

ALTER TABLE public.user_brain_claims
  ADD COLUMN IF NOT EXISTS brain_subject text;
