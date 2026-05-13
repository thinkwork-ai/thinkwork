import { describe, expect, it } from "vitest";
import { buildRunbookRunRecords } from "./runs.js";
import { loadCatalogRunbookSkills } from "./test-fixtures.js";

const runbooks = await loadCatalogRunbookSkills();

describe("artifact runbook bridge", () => {
  const requireRunbook = (slug: string) => {
    const runbook = runbooks.find((candidate) => candidate.slug === slug);
    if (!runbook) throw new Error(`Missing test runbook ${slug}`);
    return runbook;
  };

  it("keeps CRM dashboard artifact production inside the runbook phase contract", () => {
    const runbook = requireRunbook("crm-dashboard");
    const produce = runbook.phases.find((phase) => phase.id === "produce");

    expect(produce?.capabilityRoles).toEqual(["artifact_build"]);
    expect(produce?.guidanceMarkdown).toContain("CrmDashboardData");
    expect(produce?.guidanceMarkdown).toContain(
      "Call `save_app` directly in the parent Computer turn",
    );
    expect(produce?.guidanceMarkdown).toContain("metadata.runbookSlug");
    expect(produce?.guidanceMarkdown).toContain("save_app");
    expect(produce?.guidanceMarkdown).toContain(
      "Include KPI cards or `KpiStrip`",
    );
    expect(produce?.guidanceMarkdown).toContain("durable output is the saved app");
    expect(produce?.guidanceMarkdown).toContain("Do not use emoji anywhere");
    expect(produce?.guidanceMarkdown).toContain("lucide-react");

    const validate = runbook.phases.find((phase) => phase.id === "validate");
    expect(validate).toBeUndefined();

    const records = buildRunbookRunRecords({
      tenantId: "tenant-1",
      computerId: "computer-1",
      threadId: "thread-1",
      runbook,
      invocationMode: "explicit",
    });

    const produceTasks = records.tasks.filter(
      (task) => task.phase_id === "produce",
    );
    expect(produceTasks).toHaveLength(1);
    expect(
      produceTasks.every((task) =>
        task.capability_roles.includes("artifact_build"),
      ),
    ).toBe(true);
    expect(produceTasks[0]?.title).toContain("Generate and save");
  });

  it("uses the same artifact machinery for generic research dashboards", () => {
    const runbook = requireRunbook("research-dashboard");
    const produce = runbook.phases.find((phase) => phase.id === "produce");

    expect(produce?.capabilityRoles).toEqual(["artifact_build"]);
    expect(produce?.guidanceMarkdown).toContain("findings alongside evidence");
    expect(produce?.guidanceMarkdown).toContain(
      "metadata.recipe`: `research-dashboard",
    );
    expect(produce?.guidanceMarkdown).toContain("save_app");
  });

  it("keeps map artifacts on the MapView-backed artifact path", () => {
    const runbook = requireRunbook("map-artifact");
    const produce = runbook.phases.find((phase) => phase.id === "produce");

    expect(produce?.capabilityRoles).toEqual(["artifact_build", "map_build"]);
    expect(produce?.guidanceMarkdown).toContain("MapView");
    expect(produce?.guidanceMarkdown).toContain(
      "metadata.recipe`: `map-artifact",
    );
    expect(produce?.guidanceMarkdown).toContain("save_app");
  });
});
