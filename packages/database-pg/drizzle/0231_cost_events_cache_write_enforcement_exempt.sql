-- THINK-245: cache-write token capture + budget-grace flag on cost_events.
-- Hand-rolled (db:generate blocked by an unrelated interactive rename prompt);
-- apply with: psql "$DATABASE_URL" -f this file. Idempotent.
-- creates-column: public.cost_events.cached_write_tokens
-- creates-column: public.cost_events.enforcement_exempt

ALTER TABLE "cost_events"
  ADD COLUMN IF NOT EXISTS "cached_write_tokens" integer;

ALTER TABLE "cost_events"
  ADD COLUMN IF NOT EXISTS "enforcement_exempt" boolean NOT NULL DEFAULT false;
