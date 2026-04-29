-- creates-column: public.agent_templates.context_engine
ALTER TABLE public.agent_templates
  ADD COLUMN IF NOT EXISTS "context_engine" jsonb DEFAULT '{"enabled": true}'::jsonb;

UPDATE public.agent_templates
SET "context_engine" = '{"enabled": true}'::jsonb
WHERE "context_engine" IS NULL;
