import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  workItemEvents,
  workItemExternalRefs,
  workItemSavedViews,
  workItemStatuses,
  workItemThreadLinks,
  workItems,
} from "../src/schema/work-items.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const migration = readFileSync(
  resolve(repoRoot, "packages/database-pg/drizzle/0187_native_work_items.sql"),
  "utf8",
);

describe("work item schema", () => {
  it("exports the native work item tables", () => {
    expect(getTableName(workItemStatuses)).toBe("work_item_statuses");
    expect(getTableName(workItems)).toBe("work_items");
    expect(getTableName(workItemThreadLinks)).toBe("work_item_thread_links");
    expect(getTableName(workItemEvents)).toBe("work_item_events");
    expect(getTableName(workItemSavedViews)).toBe("work_item_saved_views");
    expect(getTableName(workItemExternalRefs)).toBe("work_item_external_refs");
  });

  it("declares drift markers for manual migration verification", () => {
    for (const table of [
      "work_item_statuses",
      "work_items",
      "work_item_thread_links",
      "work_item_events",
      "work_item_saved_views",
      "work_item_external_refs",
    ]) {
      expect(migration).toContain(`-- creates: public.${table}`);
    }
  });

  it("adds indexes for list, owner, thread, event, and external-ref access", () => {
    for (const indexName of [
      "idx_work_items_tenant_space_status",
      "idx_work_items_tenant_owner_user",
      "idx_work_items_tenant_due",
      "idx_work_item_thread_links_thread",
      "idx_work_item_events_item",
      "uq_work_item_external_refs_provider",
    ]) {
      expect(migration).toContain(indexName);
    }
  });

  it("enforces normalized status, priority, event, and view categories", () => {
    for (const constraintName of [
      "work_item_statuses_category_allowed",
      "work_items_priority_allowed",
      "work_item_events_type_allowed",
      "work_item_saved_views_type_allowed",
    ]) {
      expect(migration).toContain(constraintName);
    }
  });
});
