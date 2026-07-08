import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const navSource = read("src/components/settings/settings-nav.tsx");
const workflowIndexRoute = read(
  "src/routes/_authed/settings.workflows.index.tsx",
);
const workflowsIndexTabs = read(
  "src/components/workflows/WorkflowsIndexTabs.tsx",
);
const workflowInventory = read(
  "src/components/workflows/WorkflowInventory.tsx",
);
const workflowDetailRoute = read(
  "src/routes/_authed/settings.workflows.$workflowId.tsx",
);
const workflowRunRoute = read(
  "src/routes/_authed/settings.workflows.$workflowId_.runs.$runId.tsx",
);
const routinesIndexRoute = read(
  "src/routes/_authed/settings.routines.index.tsx",
);
const routineDetailRoute = read(
  "src/routes/_authed/settings.routines.$routineId.tsx",
);
const routineExecutionRoute = read(
  "src/routes/_authed/settings.routines.$routineId_.executions.$executionId.tsx",
);
const routineRedirects = read(
  "src/components/workflows/RoutineWorkflowRedirects.tsx",
);

describe("Settings workflow routing (unified Workflows section, THINK-218)", () => {
  it("exposes a single Workflows settings surface (Automations/Routines collapsed)", () => {
    expect(navSource).toContain('label: "Workflows"');
    expect(navSource).toContain('to: "/settings/workflows"');
    expect(navSource).not.toContain('label: "Automations"');
    expect(navSource).not.toContain('label: "Routines"');
  });

  it("mounts the Workflows tabs shell (Workflows/Runs/Library) plus detail and run routes", () => {
    expect(workflowIndexRoute).toContain("WorkflowsIndexTabs");
    expect(workflowsIndexTabs).toContain("WorkflowInventory");
    expect(workflowsIndexTabs).toContain("WorkflowRunsList");
    expect(workflowsIndexTabs).toContain("SettingsRoutines");
    expect(workflowDetailRoute).toContain("WorkflowDetail");
    expect(workflowRunRoute).toContain("WorkflowRunDetail");
    expect(workflowRunRoute).toContain(
      '"/_authed/settings/workflows/$workflowId_/runs/$runId"',
    );
  });

  it("navigates workflow inventory rows through TanStack Router", () => {
    expect(workflowInventory).toContain('to="/settings/workflows/$workflowId"');
    expect(workflowInventory).not.toContain(
      "href={`/settings/workflows/${encodeURIComponent(row.original.id)}`}",
    );
  });

  it("redirects the Routines list to the Workflows Routines tab, keeping routine detail URLs intact", () => {
    // The list index now redirects — Routines lives on as a Workflows tab.
    expect(routinesIndexRoute).toContain("redirect({");
    expect(routinesIndexRoute).toContain('to: "/settings/workflows"');
    expect(routinesIndexRoute).toContain('tab: "routines"');
    // The detail route still goes through RoutineDetailRouter, which renders
    // the in-app git detail for git_python routines and still falls back to
    // the Workflows redirect for legacy step_functions routines.
    expect(routineDetailRoute).toContain("RoutineDetailRouter");
    expect(routineRedirects).toContain("RoutineWorkflowDetailRedirect");
    expect(routineRedirects).toContain("SettingsGitRoutineDetail");
    // step_functions routine execution URLs still fall back to Workflows.
    expect(routineExecutionRoute).toContain("RoutineWorkflowRunRedirect");
  });
});
