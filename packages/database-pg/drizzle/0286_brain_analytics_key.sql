-- Analytics-channel visibility flag on Brain principals (THINK-656 D4) —
-- the write side of the `analyticsKey` field in both published manifests:
-- user-claims/v1 (per-user entries) and twin-mcp-keys/v2 (key entries).
-- Reader is company-brain brain-mcp/src/auth.ts, which parses literal true
-- only: `analyticsKey: true` lets the principal's brain_ask loop consult
-- the mart_analytics briefing tools. Tool VISIBILITY only, never a data
-- grant — the marts hold the tenant's own data and every query still runs
-- under the account's env gates (ANALYTICS_ENABLED et al.).
--
-- Default TRUE by decision (Eric, 2026-08-08): every user and key gets the
-- analytics channel unless an operator turns it off per row. There is no
-- console UI for the flag yet; the column is the future toggle. The NOT
-- NULL DEFAULT true also backfills every existing row, which matches the
-- 2026-08-07 go-live hand-edits this migration makes durable.
--
-- Hand-rolled (mirrors the 0274/0281/0282/0284/0285 convention; not
-- registered in meta/_journal.json).
-- Apply via: psql "$DATABASE_URL" -f drizzle/0286_brain_analytics_key.sql
-- creates-column: public.tenant_mcp_twin_keys.analytics_key
-- creates-column: public.user_brain_claims.analytics_key

ALTER TABLE public.tenant_mcp_twin_keys
  ADD COLUMN IF NOT EXISTS analytics_key boolean NOT NULL DEFAULT true;

ALTER TABLE public.user_brain_claims
  ADD COLUMN IF NOT EXISTS analytics_key boolean NOT NULL DEFAULT true;
