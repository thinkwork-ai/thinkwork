-- 0032_add_browser_automation_template_config.sql
-- Add template-level Browser Automation opt-in metadata and catalog entry.
--
-- Manual migration marker for drift reporter:
-- creates-column: public.agent_templates.browser

ALTER TABLE "agent_templates"
  ADD COLUMN IF NOT EXISTS "browser" jsonb;

INSERT INTO "capability_catalog" ("slug", "type", "source", "implementation_ref", "spec")
VALUES
  (
    'browser_automation', 'tool', 'builtin',
    jsonb_build_object('module_path', 'browser_automation_tool', 'class_name', 'BrowserAutomationTool'),
    jsonb_build_object(
      'display_name', 'Browser Automation',
      'description', 'Control a managed AgentCore Browser session with Nova Act for website workflows.'
    )
  )
ON CONFLICT ("type", "source", "slug") DO UPDATE
SET
  "implementation_ref" = EXCLUDED."implementation_ref",
  "spec" = EXCLUDED."spec",
  "updated_at" = now();
