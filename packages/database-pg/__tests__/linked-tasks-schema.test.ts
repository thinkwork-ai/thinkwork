import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { linkedTaskEvents, linkedTasks } from "../src/schema/linked-tasks";

const HERE = dirname(fileURLToPath(import.meta.url));
const migration0107 = readFileSync(
  join(HERE, "..", "drizzle", "0107_linked_task_mirror.sql"),
  "utf-8",
);

describe("Linked task mirror schema", () => {
  it("models the current external task mirror state for a Space Thread", () => {
    const columns = getTableColumns(linkedTasks);

    expect(getTableName(linkedTasks)).toBe("linked_tasks");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.space_id.notNull).toBe(true);
    expect(columns.thread_id.notNull).toBe(true);
    expect(columns.checklist_item_id.notNull).toBe(false);
    expect(columns.provider.default).toBe("lastmile");
    expect(columns.external_task_id.notNull).toBe(true);
    expect(columns.required.default).toBe(true);
    expect(columns.status.default).toBe("unknown");
    expect(columns.blocked.default).toBe(false);
    expect(columns.sync_status.default).toBe("pending");
  });

  it("models important linked task events without full provider chatter", () => {
    const columns = getTableColumns(linkedTaskEvents);

    expect(getTableName(linkedTaskEvents)).toBe("linked_task_events");
    expect(columns.tenant_id.notNull).toBe(true);
    expect(columns.linked_task_id.notNull).toBe(true);
    expect(columns.event_type.notNull).toBe(true);
    expect(columns.external_event_id.notNull).toBe(false);
    expect(columns.message.notNull).toBe(false);
  });

  it("declares manual migration markers for linked task objects", () => {
    for (const marker of [
      "creates: public.linked_tasks",
      "creates: public.linked_task_events",
      "creates: public.uq_linked_tasks_external",
      "creates: public.uq_linked_tasks_checklist_item",
      "creates-function: public.enforce_linked_task_tenant",
      "creates-function: public.enforce_linked_task_event_tenant",
      "creates-trigger: public.linked_tasks.linked_tasks_tenant_guard",
      "creates-trigger: public.linked_task_events.linked_task_events_tenant_guard",
      "creates-constraint: public.linked_task_events.linked_task_events_previous_status_allowed",
      "creates-constraint: public.linked_task_events.linked_task_events_new_status_allowed",
    ]) {
      expect(migration0107).toContain(`-- ${marker}`);
    }
  });

  it("guards linked task mirrors against cross-tenant parent references", () => {
    expect(migration0107).toContain("linked task tenant mismatch for thread");
    expect(migration0107).toContain("linked task space mismatch for thread");
    expect(migration0107).toContain(
      "linked task tenant mismatch for checklist item",
    );
    expect(migration0107).toContain(
      "linked task event parent mismatch for linked task",
    );
    expect(migration0107).toMatch(
      /CHECK \(status IN \('unknown', 'todo', 'in_progress', 'completed', 'blocked', 'cancelled'\)\)/,
    );
    expect(migration0107).toMatch(
      /CHECK \(new_status IS NULL OR new_status IN \('unknown', 'todo', 'in_progress', 'completed', 'blocked', 'cancelled'\)\)/,
    );
  });
});
