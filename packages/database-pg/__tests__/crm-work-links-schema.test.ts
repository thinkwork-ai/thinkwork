import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { crmWorkLinks } from "../src/schema/crm-work-links";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATION = readFileSync(
  resolve(__dirname, "../drizzle/0173_crm_work_links.sql"),
  "utf8",
);

describe("crm_work_links schema", () => {
  it("defines the durable CRM work-link table", () => {
    expect(getTableName(crmWorkLinks)).toBe("crm_work_links");
    const columns = getTableColumns(crmWorkLinks);

    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.provider.notNull).toBe(true);
    expect(columns.object_type.notNull).toBe(true);
    expect(columns.object_id.notNull).toBe(true);
    expect(columns.workflow_key.notNull).toBe(true);
    expect(columns.outcome_key.notNull).toBe(true);
    expect(columns.metadata.notNull).toBe(true);
  });

  it("keeps one active link per tenant/provider/object/workflow/outcome", () => {
    const config = getTableConfig(crmWorkLinks);
    const unique = config.indexes.find(
      (index) => index.config.name === "uq_crm_work_links_active_outcome",
    );

    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.where).toBeDefined();
    expect(MIGRATION).toContain("WHERE state IN ('starting','active')");
  });

  it("ships manual-migration markers for deploy drift reporting", () => {
    for (const marker of [
      "public.crm_work_links",
      "public.uq_crm_work_links_active_outcome",
      "public.idx_crm_work_links_thread",
      "public.crm_work_links_provider_allowed",
      "public.crm_work_links_workflow_key_allowed",
    ]) {
      expect(MIGRATION).toContain(marker);
    }
  });
});
