import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  WORK_ITEM_EVENT_TYPES,
  WORK_ITEM_EXTERNAL_REF_PROVIDERS,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUS_CATEGORIES,
  WORK_ITEM_THREAD_RELATIONSHIPS,
  WORK_ITEM_VIEW_TYPES,
  workItemEvents,
  workItemExternalRefs,
  workItemSavedViews,
  workItemStatuses,
  workItemThreadLinks,
  workItems,
} from "../src/schema/work-items";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0187 = readFileSync(
  join(HERE, "..", "drizzle", "0187_native_work_items.sql"),
  "utf-8",
);

describe("Work Items schema", () => {
  it("models Space-scoped native work items with status and ownership state", () => {
    const columns = getTableColumns(workItems);

    expect(getTableName(workItems)).toBe("work_items");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.space_id.notNull).toBe(true);
    expect(columns.status_id.notNull).toBe(false);
    expect(columns.title.notNull).toBe(true);
    expect(columns.priority.default).toBe("normal");
    expect(columns.required.default).toBe(true);
    expect(columns.applicable.default).toBe(true);
    expect(columns.blocked.default).toBe(false);
    expect(columns.completed_at.notNull).toBe(false);
    expect(columns.archived_at.notNull).toBe(false);
  });

  it("models Space-specific statuses and saved views", () => {
    const statusColumns = getTableColumns(workItemStatuses);
    const viewColumns = getTableColumns(workItemSavedViews);

    expect(getTableName(workItemStatuses)).toBe("work_item_statuses");
    expect(statusColumns.category.default).toBe("todo");
    expect(statusColumns.is_active.default).toBe(true);
    expect(statusColumns.is_final.default).toBe(false);
    expect(statusColumns.is_default.default).toBe(false);
    expect(statusColumns.display_order.default).toBe(0);

    expect(getTableName(workItemSavedViews)).toBe("work_item_saved_views");
    expect(viewColumns.view_type.default).toBe("list");
    expect(viewColumns.is_private.default).toBe(true);
    expect(viewColumns.is_default.default).toBe(false);
    expect(viewColumns.is_favorite.default).toBe(false);
  });

  it("models thread links, events, and external references", () => {
    expect(getTableName(workItemThreadLinks)).toBe("work_item_thread_links");
    expect(getTableColumns(workItemThreadLinks).relationship.default).toBe(
      "primary",
    );

    expect(getTableName(workItemEvents)).toBe("work_item_events");
    expect(getTableColumns(workItemEvents).event_type.notNull).toBe(true);

    expect(getTableName(workItemExternalRefs)).toBe("work_item_external_refs");
    expect(getTableColumns(workItemExternalRefs).external_id.notNull).toBe(
      true,
    );
  });

  it("declares constrained vocabularies in schema and migration", () => {
    expect(WORK_ITEM_STATUS_CATEGORIES).toEqual([
      "todo",
      "active",
      "blocked",
      "done",
      "skipped",
    ]);
    expect(WORK_ITEM_PRIORITIES).toEqual(["low", "normal", "high", "urgent"]);
    expect(WORK_ITEM_EVENT_TYPES).toContain("agent_action");
    expect(WORK_ITEM_VIEW_TYPES).toEqual(["list", "board"]);
    expect(WORK_ITEM_THREAD_RELATIONSHIPS).toContain("evidence");
    expect(WORK_ITEM_EXTERNAL_REF_PROVIDERS).toContain("plane");

    const checks = [
      ...getTableConfig(workItemStatuses).checks,
      ...getTableConfig(workItems).checks,
      ...getTableConfig(workItemThreadLinks).checks,
      ...getTableConfig(workItemEvents).checks,
      ...getTableConfig(workItemSavedViews).checks,
      ...getTableConfig(workItemExternalRefs).checks,
    ].map((check) => check.name);

    expect(checks).toEqual(
      expect.arrayContaining([
        "work_item_statuses_category_allowed",
        "work_items_priority_allowed",
        "work_item_thread_links_relationship_allowed",
        "work_item_events_type_allowed",
        "work_item_saved_views_type_allowed",
        "work_item_saved_views_owner_required",
        "work_item_external_refs_provider_allowed",
      ]),
    );

    for (const literal of [
      "'todo', 'active', 'blocked', 'done', 'skipped'",
      "'low', 'normal', 'high', 'urgent'",
      "'list', 'board'",
      "'thinkwork', 'lastmile', 'linear', 'plane', 'twenty'",
    ]) {
      expect(migration0187).toContain(literal);
    }
  });

  it("declares manual migration drift markers for all Work Item objects", () => {
    for (const marker of [
      "creates: public.work_item_statuses",
      "creates: public.work_items",
      "creates: public.work_item_thread_links",
      "creates: public.work_item_events",
      "creates: public.work_item_saved_views",
      "creates: public.work_item_external_refs",
      "creates: public.uq_work_item_statuses_space_default",
      "creates: public.idx_work_items_space_status",
      "creates: public.idx_work_item_thread_links_thread",
      "creates: public.idx_work_item_events_item_created",
      "creates: public.uq_work_item_saved_views_user_default",
      "creates: public.uq_work_item_external_refs_provider",
      "creates-constraint: public.work_item_statuses.work_item_statuses_category_allowed",
      "creates-constraint: public.work_items.work_items_priority_allowed",
      "creates-constraint: public.work_item_saved_views.work_item_saved_views_owner_required",
    ]) {
      expect(migration0187).toContain(`-- ${marker}`);
    }
  });
});
