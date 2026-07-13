-- THINK-280 U4: capability-private VPC-mode Code Interpreter id.
--
-- Additive nullable column on tenants for the third per-tenant interpreter (no
-- NAT; reaches only the capability broker's private execute-api VPCE). Populated
-- by the agentcore-admin Lambda only when the broker is enabled; NULL otherwise.
-- Existing sandbox selection (default-public / internal-only) is unchanged.
--
-- Hand-rolled additive column; not in meta/_journal.json. Apply with:
-- psql "$DATABASE_URL" -f <this file>.
-- creates-column: public.tenants.sandbox_interpreter_capability_private_id

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS sandbox_interpreter_capability_private_id text;
