import { describe, expect, it } from "vitest";
import {
  buildRunbookDefinitionSnapshot,
  buildRunbookRunRecords,
  transitionRunbookRunStatus,
} from "./runs.js";
import { loadCatalogRunbookSkills } from "./test-fixtures.js";

const runbooks = await loadCatalogRunbookSkills();

describe("runbook run helpers", () => {
  const requireRunbook = (slug: string) => {
    const runbook = runbooks.find((candidate) => candidate.slug === slug);
    if (!runbook) throw new Error(`Missing test runbook ${slug}`);
    return runbook;
  };

  it("creates a run snapshot with the selected source version and task skeleton", () => {
    const runbook = requireRunbook("research-dashboard");
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
    expect(records.run.definition_snapshot).toMatchObject(runbook);
    expect(records.run.definition_snapshot).toMatchObject({
      skill: {
        skillMdSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contractSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        assetRefs: ["assets/research-dashboard-layout.json"],
      },
    });
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

  it("snapshots activated skill source, contract, and asset references", () => {
    const baseRunbook = requireRunbook("crm-dashboard");
    const runbook = {
      ...baseRunbook,
      skill: {
        slug: "crm-dashboard",
        source: "template-workspace",
        skillMdPath: "skills/crm-dashboard/SKILL.md",
        skillMd:
          "---\nname: crm-dashboard\n---\n\n# CRM Dashboard\n\nFollow the dashboard skill.",
        skillBody: "# CRM Dashboard\n\nFollow the dashboard skill.",
        frontmatter: {
          name: "crm-dashboard",
          metadata: { thinkwork_kind: "computer-runbook" },
        },
        contractPath: "references/thinkwork-runbook.json",
        contract: {
          assets: ["assets/crm-dashboard-data.schema.json"],
          outputs: [
            {
              id: "dashboard",
              asset: "assets/dashboard-layout.json",
            },
          ],
        },
      },
    };

    const snapshot = buildRunbookDefinitionSnapshot(runbook);

    expect(snapshot.slug).toBe("crm-dashboard");
    expect(snapshot.phases).toEqual(baseRunbook.phases);
    expect(snapshot.skill).toMatchObject({
      slug: "crm-dashboard",
      source: "template-workspace",
      skillMdPath: "skills/crm-dashboard/SKILL.md",
      skillMd: expect.stringContaining("# CRM Dashboard"),
      skillBody: expect.stringContaining("Follow the dashboard skill."),
      contractPath: "references/thinkwork-runbook.json",
      assetRefs: [
        "assets/crm-dashboard-data.schema.json",
        "assets/dashboard-layout.json",
      ],
    });
    expect((snapshot.skill as { skillMdSha256: string }).skillMdSha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(
      (snapshot.skill as { contractSha256: string }).contractSha256,
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves declared phase ids and dependency order in expanded tasks", () => {
    const runbook = requireRunbook("crm-dashboard");
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
    expect(records.tasks[0]?.details).toMatchObject({
      supervision: { staleAfterMinutes: 5 },
    });
    expect(records.tasks.at(-1)?.details).toMatchObject({
      supervision: { staleAfterMinutes: 15 },
    });
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
