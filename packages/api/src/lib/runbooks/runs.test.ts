import { describe, expect, it } from "vitest";
import { runbookRegistry } from "@thinkwork/runbooks";
import { buildRunbookRunRecords, transitionRunbookRunStatus } from "./runs.js";

describe("runbook run helpers", () => {
  it("creates a run snapshot with the selected source version and task skeleton", () => {
    const runbook = runbookRegistry.require("research-dashboard");
    const records = buildRunbookRunRecords({
      tenantId: "tenant-1",
      computerId: "computer-1",
      catalogId: "catalog-1",
      threadId: "thread-1",
      selectedByMessageId: "message-1",
      runbook,
      invocationMode: "auto",
      inputs: { query: "enterprise procurement" },
      idempotencyKey: "runbook:message-1",
    });

    expect(records.run).toEqual(
      expect.objectContaining({
        tenant_id: "tenant-1",
        computer_id: "computer-1",
        catalog_id: "catalog-1",
        thread_id: "thread-1",
        runbook_slug: "research-dashboard",
        runbook_version: runbook.version,
        status: "awaiting_confirmation",
        invocation_mode: "auto",
        idempotency_key: "runbook:message-1",
      }),
    );
    expect(records.run.definition_snapshot).toEqual(runbook);
    expect(records.tasks).toHaveLength(
      runbook.phases.reduce(
        (total, phase) => total + phase.taskSeeds.length,
        0,
      ),
    );
    expect(records.tasks.map((task) => task.sort_order)).toEqual(
      records.tasks.map((_, index) => index + 1),
    );
  });

  it("preserves declared phase ids and dependency order in expanded tasks", () => {
    const runbook = runbookRegistry.require("crm-dashboard");
    const records = buildRunbookRunRecords({
      tenantId: "tenant-1",
      computerId: "computer-1",
      runbook,
    });
    const phaseIds = new Set(runbook.phases.map((phase) => phase.id));
    const taskKeys = new Set(records.tasks.map((task) => task.task_key));

    for (const task of records.tasks) {
      expect(phaseIds.has(task.phase_id)).toBe(true);
      for (const dependency of task.depends_on) {
        expect(taskKeys.has(String(dependency))).toBe(true);
      }
    }
    expect(records.tasks[0]?.depends_on).toEqual([]);
    expect(records.tasks.at(-1)?.sort_order).toBe(records.tasks.length);
  });

  it("confirms awaiting runs and treats queued confirmation as idempotent", () => {
    expect(
      transitionRunbookRunStatus("awaiting_confirmation", "confirm"),
    ).toEqual({ status: "queued" });
    expect(transitionRunbookRunStatus("queued", "confirm")).toEqual({
      status: "queued",
      idempotent: true,
    });
  });

  it("rejects only awaiting-confirmation runs", () => {
    expect(
      transitionRunbookRunStatus("awaiting_confirmation", "reject"),
    ).toEqual({ status: "rejected" });
    expect(() => transitionRunbookRunStatus("queued", "reject")).toThrow(
      "Cannot reject runbook run in queued status",
    );
  });

  it("blocks terminal-state transitions", () => {
    expect(() => transitionRunbookRunStatus("completed", "cancel")).toThrow(
      "Cannot cancel runbook run in completed status",
    );
    expect(() => transitionRunbookRunStatus("rejected", "confirm")).toThrow(
      "Cannot confirm runbook run in rejected status",
    );
  });
});
