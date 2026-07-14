-- THINK-291: promote json-render-ui (emit_json_render_ui generated UI) from a
-- hidden agent_capabilities row to a standard platform-tool opt-in column on
-- agents, matching sandbox/browser/web_search/web_extract/send_email/
-- context_engine. Default-on so charts and rich result chunks work out of the
-- box on greenfield stages (the legacy row was unseeded and invisible).
--
-- The runtime cutover in the same PR reads this column and retires the
-- agent_capabilities 'thread-json-render-ui' read; existing agents inherit
-- enabled-on via the UPDATE below unless a legacy row explicitly disabled the
-- capability.
--
-- creates-column: public.agents.json_render_ui

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS json_render_ui jsonb DEFAULT '{"enabled": true}'::jsonb;

-- Legacy carry-over: an agent whose capability row was explicitly disabled
-- stays disabled (ADD COLUMN already filled every existing row with the
-- enabled default).
UPDATE public.agents a
SET json_render_ui = '{"enabled": false}'::jsonb
FROM public.agent_capabilities c
WHERE c.agent_id = a.id
  AND c.capability = 'thread-json-render-ui'
  AND c.enabled = false;
