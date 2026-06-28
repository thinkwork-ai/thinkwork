import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  WORK_ITEM_DOCUMENT_KINDS,
  WORK_ITEM_EVENT_TYPES,
  WORK_ITEM_EXTERNAL_REF_PROVIDERS,
  WORK_ITEM_DOGFOOD_LABELS,
  WORK_ITEM_OPEN_ENGINE_DEPENDENCY_STATES,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUS_CATEGORIES,
  WORK_ITEM_THREAD_RELATIONSHIPS,
  WORK_ITEM_VIEW_TYPES,
  workItemEvents,
  workItemExternalRefs,
  workItemComments,
  workItemDocuments,
  workItemLabelAssignments,
  workItemLabels,
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
const migration0191 = readFileSync(
  join(HERE, "..", "drizzle", "0191_open_engine_work_item_queue.sql"),
  "utf-8",
);
const migration0192 = readFileSync(
  join(HERE, "..", "drizzle", "0192_work_item_labels.sql"),
  "utf-8",
);
const migration0193 = readFileSync(
  join(HERE, "..", "drizzle", "0193_work_item_documents.sql"),
  "utf-8",
);
const migration0194 = readFileSync(
  join(HERE, "..", "drizzle", "0194_work_item_comments.sql"),
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

  it("models Open Engine queue state on Work Items", () => {
    const columns = getTableColumns(workItems);

    expect(columns.open_engine_enabled.default).toBe(false);
    expect(columns.open_engine_queue_key.notNull).toBe(false);
    expect(columns.open_engine_claimed_by_agent_id.notNull).toBe(false);
    expect(columns.open_engine_claimed_at.notNull).toBe(false);
    expect(columns.open_engine_claim_expires_at.notNull).toBe(false);
    expect(columns.open_engine_human_hold.default).toBe(false);
    expect(columns.open_engine_human_hold_reason.notNull).toBe(false);
    expect(columns.open_engine_scheduled_at.notNull).toBe(false);
    expect(columns.open_engine_dependency_state.default).toBe("ready");
    expect(columns.open_engine_dependency_state.notNull).toBe(true);
    expect(columns.open_engine_routing.notNull).toBe(false);
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

    const commentColumns = getTableColumns(workItemComments);
    expect(getTableName(workItemComments)).toBe("work_item_comments");
    expect(commentColumns.tenant_id.notNull).toBe(true);
    expect(commentColumns.space_id.notNull).toBe(true);
    expect(commentColumns.work_item_id.notNull).toBe(true);
    expect(commentColumns.thread_id.notNull).toBe(false);
    expect(commentColumns.author_user_id.notNull).toBe(false);
    expect(commentColumns.author_agent_id.notNull).toBe(false);
    expect(commentColumns.body.notNull).toBe(true);
    expect(commentColumns.archived_at.notNull).toBe(false);
  });

  it("models tenant-scoped Work Item labels and assignments", () => {
    const labelColumns = getTableColumns(workItemLabels);
    const assignmentColumns = getTableColumns(workItemLabelAssignments);

    expect(getTableName(workItemLabels)).toBe("work_item_labels");
    expect(labelColumns.tenant_id.notNull).toBe(true);
    expect(labelColumns.name.notNull).toBe(true);
    expect(labelColumns.slug.notNull).toBe(true);
    expect(labelColumns.color.notNull).toBe(false);
    expect(labelColumns.archived_at.notNull).toBe(false);

    expect(getTableName(workItemLabelAssignments)).toBe(
      "work_item_label_assignments",
    );
    expect(assignmentColumns.tenant_id.notNull).toBe(true);
    expect(assignmentColumns.work_item_id.notNull).toBe(true);
    expect(assignmentColumns.label_id.notNull).toBe(true);
  });

  it("models S3-backed Work Item documents", () => {
    const columns = getTableColumns(workItemDocuments);

    expect(getTableName(workItemDocuments)).toBe("work_item_documents");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.work_item_id.notNull).toBe(true);
    expect(columns.kind.default).toBe("note");
    expect(columns.title.notNull).toBe(true);
    expect(columns.content_type.default).toBe("text/markdown");
    expect(columns.s3_key.notNull).toBe(true);
    expect(columns.size_bytes.default).toBe(0);
    expect(columns.checksum_sha256.notNull).toBe(false);
    expect(columns.archived_at.notNull).toBe(false);
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
    expect(WORK_ITEM_EVENT_TYPES).toContain("comment_added");
    expect(WORK_ITEM_VIEW_TYPES).toEqual(["list", "board"]);
    expect(WORK_ITEM_THREAD_RELATIONSHIPS).toContain("evidence");
    expect(WORK_ITEM_EXTERNAL_REF_PROVIDERS).toContain("plane");
    expect(WORK_ITEM_OPEN_ENGINE_DEPENDENCY_STATES).toEqual([
      "ready",
      "waiting",
    ]);
    expect(WORK_ITEM_DOGFOOD_LABELS).toEqual([
      "openengine",
      "dogfood",
      "codex",
      "claude",
      "thinkwork-agent",
      "bug",
      "feature",
      "docs",
      "infra",
      "needs-human",
      "review",
      "blocked",
    ]);
    expect(WORK_ITEM_DOCUMENT_KINDS).toEqual([
      "plan",
      "progress",
      "spec",
      "evidence",
      "handoff",
      "note",
      "other",
    ]);

    const checks = [
      ...getTableConfig(workItemStatuses).checks,
      ...getTableConfig(workItems).checks,
      ...getTableConfig(workItemDocuments).checks,
      ...getTableConfig(workItemComments).checks,
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
        "work_items_open_engine_dependency_state_allowed",
        "work_item_documents_kind_allowed",
        "work_item_comments_author_required",
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
    expect(migration0191).toContain(
      "CHECK (open_engine_dependency_state IN ('ready', 'waiting'))",
    );
    expect(migration0193).toContain(
      "CHECK (kind IN ('plan','progress','spec','evidence','handoff','note','other'))",
    );
    expect(migration0194).toContain("'comment_added'");
  });

  it("declares Open Engine queue indexes for eligibility and claims", () => {
    expect(migration0191).toContain(
      "CREATE INDEX IF NOT EXISTS idx_work_items_open_engine_ready",
    );
    expect(migration0191).toContain("open_engine_queue_key");
    expect(migration0191).toContain("open_engine_scheduled_at");
    expect(migration0191).toContain("open_engine_claim_expires_at");
    expect(migration0191).toContain("open_engine_human_hold = false");
    expect(migration0191).toContain("blocked = false");
    expect(migration0191).toContain("open_engine_dependency_state = 'ready'");
    expect(migration0191).toContain(
      "CREATE INDEX IF NOT EXISTS idx_work_items_open_engine_claim",
    );
    expect(migration0191).toContain("open_engine_claimed_by_agent_id");
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

  it("declares manual migration drift markers for Open Engine queue state", () => {
    for (const marker of [
      "creates-column: public.work_items.open_engine_enabled",
      "creates-column: public.work_items.open_engine_queue_key",
      "creates-column: public.work_items.open_engine_claimed_by_agent_id",
      "creates-column: public.work_items.open_engine_claim_expires_at",
      "creates-column: public.work_items.open_engine_human_hold",
      "creates-column: public.work_items.open_engine_scheduled_at",
      "creates-column: public.work_items.open_engine_dependency_state",
      "creates-column: public.work_items.open_engine_routing",
      "creates: public.idx_work_items_open_engine_ready",
      "creates: public.idx_work_items_open_engine_claim",
      "creates-constraint: public.work_items.work_items_open_engine_dependency_state_allowed",
    ]) {
      expect(migration0191).toContain(`-- ${marker}`);
    }
  });

  it("declares manual migration drift markers for Work Item labels", () => {
    for (const marker of [
      "creates: public.work_item_labels",
      "creates: public.work_item_label_assignments",
      "creates: public.uq_work_item_labels_tenant_slug",
      "creates: public.idx_work_item_labels_tenant_active",
      "creates: public.uq_work_item_label_assignments_pair",
      "creates: public.idx_work_item_label_assignments_label",
      "creates: public.idx_work_item_label_assignments_item",
    ]) {
      expect(migration0192).toContain(`-- ${marker}`);
    }
  });

  it("declares manual migration drift markers for Work Item documents", () => {
    for (const marker of [
      "creates: public.work_item_documents",
      "creates: public.idx_work_item_documents_item_active",
      "creates: public.idx_work_item_documents_tenant_kind",
      "creates-constraint: public.work_item_documents.work_item_documents_kind_allowed",
    ]) {
      expect(migration0193).toContain(`-- ${marker}`);
    }
  });

  it("declares manual migration drift markers for Work Item comments", () => {
    for (const marker of [
      "creates: public.work_item_comments",
      "creates: public.idx_work_item_comments_item_created",
      "creates: public.idx_work_item_comments_thread",
      "creates-constraint: public.work_item_comments.work_item_comments_author_required",
    ]) {
      expect(migration0194).toContain(`-- ${marker}`);
    }
  });
});
