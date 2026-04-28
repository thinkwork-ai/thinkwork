-- creates-column: public.agent_templates.web_search
ALTER TABLE "agent_templates"
  ADD COLUMN IF NOT EXISTS "web_search" jsonb DEFAULT '{"enabled": true}'::jsonb;

UPDATE "agent_templates"
SET "web_search" = '{"enabled": true}'::jsonb
WHERE "web_search" IS NULL;
