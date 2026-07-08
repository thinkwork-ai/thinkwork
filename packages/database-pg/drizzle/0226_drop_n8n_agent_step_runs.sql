-- THINK-217/218: drop the retired n8n agent-step bridge run table. The
-- code-removal deploy (PR #3519) landed first per the migration ordering
-- rules; no readers or writers remain.
-- (Destructive: no creates markers — the drift reporter has nothing to check.)

DROP TABLE IF EXISTS public.n8n_agent_step_runs;
