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

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0105 = readFileSync(
  join(HERE, "..", "drizzle", "0105_spaces_domain.sql"),
  "utf-8",
);

describe("Spaces schema", () => {
  it("models tenant-scoped Spaces with prompt and template metadata", () => {
    const columns = getTableColumns(spaces);

    expect(getTableName(spaces)).toBe("spaces");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.slug.notNull).toBe(true);
    expect(columns.prompt.notNull).toBe(false);
    expect(columns.status.default).toBe("active");
    expect(columns.kind.default).toBe("custom");
    expect(columns.template_key.notNull).toBe(false);
  });

  it("models Space-local members, agents, checklists, and integrations", () => {
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
