import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  spaceAgentAssignments,
  spaceChecklistItems,
  spaceChecklistTemplates,
  spaceIntegrations,
  spaceMembers,
  spaces,
} from "../src/schema/spaces";
import { spaceKnowledgeBases } from "../src/schema/knowledge-bases";
import { spaceMcpServers } from "../src/schema/mcp-servers";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0105 = readFileSync(
  join(HERE, "..", "drizzle", "0105_spaces_domain.sql"),
  "utf-8",
);
const migration0112 = readFileSync(
  join(HERE, "..", "drizzle", "0112_recast_spaces_as_contextual_workrooms.sql"),
  "utf-8",
);
const migration0117 = readFileSync(
  join(HERE, "..", "drizzle", "0117_space_access_mode.sql"),
  "utf-8",
);
const migration0119 = readFileSync(
  join(HERE, "..", "drizzle", "0119_space_knowledge_bases.sql"),
  "utf-8",
);
const migration0122 = readFileSync(
  join(HERE, "..", "drizzle", "0122_space_email_triggers.sql"),
  "utf-8",
);
const migration0123 = readFileSync(
  join(HERE, "..", "drizzle", "0123_single_platform_agent_and_overrides.sql"),
  "utf-8",
);

describe("Spaces schema", () => {
  it("models tenant-scoped Spaces with contextual workroom metadata", () => {
    const columns = getTableColumns(spaces);

    expect(getTableName(spaces)).toBe("spaces");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.slug.notNull).toBe(true);
    expect(columns.prompt.notNull).toBe(false);
    expect(columns.status.default).toBe("active");
    expect(columns.kind.default).toBe("custom");
    expect(columns.access_mode.notNull).toBe(true);
    expect(columns.access_mode.default).toBe("public");
    expect(columns.icon.notNull).toBe(false);
    expect(columns.category.notNull).toBe(false);
    expect(columns.template_key.notNull).toBe(false);
    expect(columns.context_config.notNull).toBe(false);
    expect(columns.connected_data_config.notNull).toBe(false);
    expect(columns.tool_policy.notNull).toBe(false);
    expect(columns.mcp_policy.notNull).toBe(false);
    expect(columns.agent_availability_policy.notNull).toBe(false);
    expect(columns.trigger_config.notNull).toBe(false);
    expect(columns.email_triggers_enabled.notNull).toBe(true);
    expect(columns.email_triggers_enabled.default).toBe(false);
    expect(columns.model_override.notNull).toBe(false);
    expect(columns.guardrail_id_override.notNull).toBe(false);
    expect(columns.budget_monthly_cents_override.notNull).toBe(false);
    expect(columns.budget_paused_override.notNull).toBe(false);
    expect(columns.sandbox_override.notNull).toBe(false);
    expect(columns.render_diagnostics.notNull).toBe(false);
  });

  it("models Space-local members, agents, MCP servers, checklists, and integrations", () => {
    expect(getTableName(spaceMembers)).toBe("space_members");
    expect(getTableColumns(spaceMembers).notification_preference.default).toBe(
      "subscribed",
    );

    expect(getTableName(spaceAgentAssignments)).toBe("space_agent_assignments");
    expect(
      getTableColumns(spaceAgentAssignments).local_instructions.notNull,
    ).toBe(false);
    expect(getTableColumns(spaceAgentAssignments).auto_subscribe.default).toBe(
      true,
    );

    expect(getTableName(spaceMcpServers)).toBe("space_mcp_servers");
    expect(getTableColumns(spaceMcpServers).enabled.default).toBe(true);
    expect(getTableColumns(spaceMcpServers).config.notNull).toBe(false);

    expect(getTableName(spaceKnowledgeBases)).toBe("space_knowledge_bases");
    expect(getTableColumns(spaceKnowledgeBases).enabled.default).toBe(true);
    expect(getTableColumns(spaceKnowledgeBases).search_config.notNull).toBe(
      false,
    );

    expect(getTableName(spaceChecklistTemplates)).toBe(
      "space_checklist_templates",
    );
    expect(getTableName(spaceChecklistItems)).toBe("space_checklist_items");
    expect(getTableColumns(spaceChecklistItems).required.default).toBe(true);

    expect(getTableName(spaceIntegrations)).toBe("space_integrations");
    expect(getTableColumns(spaceIntegrations).writeback_policy.default).toBe(
      "disabled",
    );
  });

  it("declares manual migration drift markers for every Spaces table", () => {
    for (const table of [
      "spaces",
      "space_members",
      "space_agent_assignments",
      "space_checklist_templates",
      "space_checklist_items",
      "space_integrations",
    ]) {
      expect(migration0105).toMatch(
        new RegExp(`--\\s*creates:\\s*public\\.${table}\\b`),
      );
      expect(migration0105).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`),
      );
    }
  });

  it("declares manual migration drift markers for contextual workroom additions", () => {
    for (const column of [
      "icon",
      "category",
      "context_config",
      "connected_data_config",
      "tool_policy",
      "mcp_policy",
      "agent_availability_policy",
      "trigger_config",
      "render_diagnostics",
    ]) {
      expect(migration0112).toMatch(
        new RegExp(`--\\s*creates-column:\\s*public\\.spaces\\.${column}\\b`),
      );
      expect(migration0112).toMatch(
        new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`),
      );
    }

    expect(migration0112).toMatch(
      /--\s*creates:\s*public\.space_mcp_servers\b/,
    );
    expect(migration0112).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.space_mcp_servers\b/,
    );
    expect(migration0112).toContain(
      "CREATE TRIGGER space_mcp_servers_tenant_guard",
    );
    expect(migration0112).toContain("space MCP server tenant mismatch");
  });

  it("declares manual migration drift markers for Space access mode", () => {
    expect(migration0117).toMatch(
      /--\s*creates-column:\s*public\.spaces\.access_mode\b/,
    );
    expect(migration0117).toMatch(
      /--\s*creates-constraint:\s*public\.spaces\.spaces_access_mode_allowed\b/,
    );
    expect(migration0117).toMatch(/ADD COLUMN IF NOT EXISTS access_mode text/);
    expect(migration0117).toContain(
      "ALTER COLUMN access_mode SET DEFAULT 'public'",
    );
    expect(migration0117).toContain("ALTER COLUMN access_mode SET NOT NULL");
    expect(migration0117).toContain(
      "CHECK (access_mode IN ('public','private'))",
    );
  });

  it("declares manual migration drift markers for Space knowledge bases", () => {
    expect(migration0119).toMatch(
      /--\s*creates:\s*public\.space_knowledge_bases\b/,
    );
    expect(migration0119).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.space_knowledge_bases\b/,
    );
    expect(migration0119).toMatch(/--\s*creates:\s*public\.uq_space_kb\b/);
    expect(migration0119).toMatch(
      /--\s*creates-trigger:\s*public\.space_knowledge_bases\.space_knowledge_bases_tenant_guard\b/,
    );
    expect(migration0119).toContain(
      "CREATE TRIGGER space_knowledge_bases_tenant_guard",
    );
    expect(migration0119).toContain("space knowledge base tenant mismatch");
  });

  it("declares manual migration drift markers for per-Space email triggers", () => {
    expect(migration0122).toMatch(
      /--\s*creates-column:\s*public\.spaces\.email_triggers_enabled\b/,
    );
    expect(migration0122).toMatch(
      /ADD COLUMN IF NOT EXISTS email_triggers_enabled boolean\b/,
    );
    expect(migration0122).toContain(
      "ALTER COLUMN email_triggers_enabled SET DEFAULT false",
    );
    expect(migration0122).toContain(
      "ALTER COLUMN email_triggers_enabled SET NOT NULL",
    );
  });

  it("declares manual migration drift markers for Space runtime overrides", () => {
    for (const column of [
      "model_override",
      "guardrail_id_override",
      "budget_monthly_cents_override",
      "budget_paused_override",
      "sandbox_override",
    ]) {
      expect(migration0123).toMatch(
        new RegExp(`--\\s*creates-column:\\s*public\\.spaces\\.${column}\\b`),
      );
      expect(migration0123).toMatch(
        new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`),
      );
    }
    expect(migration0123).toMatch(
      /--\s*creates-constraint:\s*public\.spaces\.spaces_guardrail_id_override_guardrails_id_fk\b/,
    );
    expect(migration0123).toContain(
      "CONSTRAINT spaces_guardrail_id_override_guardrails_id_fk",
    );
    expect(migration0123).toContain("FOREIGN KEY (guardrail_id_override)");
    expect(migration0123).toContain("REFERENCES public.guardrails(id)");
  });

  it("guards Space child rows against cross-tenant references", () => {
    expect(migration0105).toMatch(
      /CREATE OR REPLACE FUNCTION public\.enforce_space_child_tenant\(\)/,
    );
    for (const trigger of [
      "space_members_tenant_guard",
      "space_agent_assignments_tenant_guard",
      "space_checklist_templates_tenant_guard",
      "space_checklist_items_tenant_guard",
      "space_integrations_tenant_guard",
    ]) {
      expect(migration0105).toContain(`CREATE TRIGGER ${trigger}`);
    }
    expect(migration0105).toContain("space child tenant mismatch");
    expect(migration0105).toContain("space member tenant mismatch");
    expect(migration0105).toContain("space agent assignment tenant mismatch");
    expect(migration0105).toContain("space checklist item tenant mismatch");
  });
});
