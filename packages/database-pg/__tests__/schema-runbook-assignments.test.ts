import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { agentTemplateRunbookAssignments } from "../src/schema/runbook-assignments";
import { agentTemplates } from "../src/schema/agent-templates";
import { tenantRunbookCatalog } from "../src/schema/runbooks";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(HERE, "..", "drizzle", "0085_agent_template_runbook_assignments.sql"),
  "utf-8",
);

const indexNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).indexes.map((index) => index.config.name);

const indexByName = (
  table: Parameters<typeof getTableConfig>[0],
  name: string,
) => getTableConfig(table).indexes.find((index) => index.config.name === name);

const foreignKeyNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((foreignKey) => foreignKey.getName());

describe("runbook assignment schema", () => {
  it("defines template-scoped runbook assignment columns", () => {
    const columns = getTableColumns(agentTemplateRunbookAssignments);

    expect(getTableName(agentTemplateRunbookAssignments)).toBe(
      "agent_template_runbook_assignments",
    );
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.template_id.notNull).toBe(true);
    expect(columns.catalog_id.notNull).toBe(true);
    expect(columns.enabled.notNull).toBe(true);
    expect(columns.enabled.hasDefault).toBe(true);
    expect(columns.config.notNull).toBe(false);
    expect(columns.created_at.notNull).toBe(true);
    expect(columns.updated_at.notNull).toBe(true);
  });

  it("declares lookup and uniqueness indexes", () => {
    expect(indexNames(agentTemplateRunbookAssignments)).toEqual(
      expect.arrayContaining([
        "uq_agent_template_runbook_assignments",
        "idx_agent_template_runbook_assignments_template",
        "idx_agent_template_runbook_assignments_catalog",
      ]),
    );

    const uniqueAssignmentIndex = indexByName(
      agentTemplateRunbookAssignments,
      "uq_agent_template_runbook_assignments",
    );
    expect(uniqueAssignmentIndex?.config.unique).toBe(true);
    expect(
      uniqueAssignmentIndex?.config.columns.map((column) =>
        "name" in column ? column.name : null,
      ),
    ).toEqual(["template_id", "catalog_id"]);
  });

  it("declares tenant-consistency foreign keys and parent unique indexes", () => {
    expect(indexNames(agentTemplates)).toContain("uq_agent_templates_tenant_id_id");
    expect(indexNames(tenantRunbookCatalog)).toContain(
      "tenant_runbook_catalog_tenant_id_id_uq",
    );

    expect(foreignKeyNames(agentTemplateRunbookAssignments)).toEqual(
      expect.arrayContaining([
        "fk_agent_template_runbook_assignments_template_tenant",
        "fk_agent_template_runbook_assignments_catalog_tenant",
      ]),
    );
  });

  it("declares manual migration markers for drift reporting", () => {
    expect(migration).toContain(
      "-- creates: public.agent_template_runbook_assignments",
    );
    expect(migration).toContain("-- creates: public.uq_agent_templates_tenant_id_id");
    expect(migration).toContain(
      "-- creates: public.tenant_runbook_catalog_tenant_id_id_uq",
    );
    expect(migration).toContain(
      "-- creates: public.uq_agent_template_runbook_assignments",
    );
    expect(migration).toContain(
      "-- creates: public.idx_agent_template_runbook_assignments_template",
    );
    expect(migration).toContain(
      "-- creates: public.idx_agent_template_runbook_assignments_catalog",
    );
    expect(migration).toContain(
      "FOREIGN KEY (tenant_id, template_id)\n    REFERENCES public.agent_templates (tenant_id, id)\n    ON DELETE CASCADE",
    );
    expect(migration).toContain(
      "FOREIGN KEY (tenant_id, catalog_id)\n    REFERENCES public.tenant_runbook_catalog (tenant_id, id)\n    ON DELETE CASCADE",
    );
    expect(migration).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_template_runbook_assignments\n  ON public.agent_template_runbook_assignments (template_id, catalog_id)",
    );
  });
});
