-- Idempotency for the seedEvalTestCases mutation. Without this, calling
-- seedEvalTestCases twice would duplicate every yaml-seed row. The partial
-- index intentionally scopes to source='yaml-seed' so user-authored tests
-- can re-use any name they like without colliding with the seed pack.
CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_test_cases_tenant_seed_name
ON eval_test_cases (tenant_id, name)
WHERE source = 'yaml-seed';
