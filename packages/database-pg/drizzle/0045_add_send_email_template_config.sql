-- creates-column: public.agent_templates.send_email
ALTER TABLE "agent_templates"
  ADD COLUMN IF NOT EXISTS "send_email" jsonb DEFAULT '{"enabled": true}'::jsonb;

UPDATE "agent_templates"
SET "send_email" = '{"enabled": true}'::jsonb
WHERE "send_email" IS NULL;
