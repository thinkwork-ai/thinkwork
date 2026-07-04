import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const navSource = read("src/components/settings/settings-nav.tsx");
const workflowIndexRoute = read(
  "src/routes/_authed/settings.workflows.index.tsx",
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
const routineListRoute = read("src/routes/_authed/settings.routines.index.tsx");
const routineDetailRoute = read(
  "src/routes/_authed/settings.routines.$routineId.tsx",
);
const routineExecutionRoute = read(
  "src/routes/_authed/settings.routines.$routineId_.executions.$executionId.tsx",
);

describe("Settings workflow routing", () => {
  it("exposes both Workflows (step_functions) and Routines (git_python) as settings surfaces", () => {
    expect(navSource).toContain('label: "Workflows"');
    expect(navSource).toContain('to: "/settings/workflows"');
    // Deterministic git-backed routines are their own top-level surface
    // (plan 2026-07-03-004) — distinct from the step_functions Workflows
    // page. The legacy step_functions routine *detail* URLs still redirect
    // to Workflows (asserted below).
    expect(navSource).toContain('label: "Routines"');
    expect(navSource).toContain('to: "/settings/routines"');
  });

  it("mounts aggregate workflow inventory, detail, and run routes", () => {
    expect(workflowIndexRoute).toContain("WorkflowInventory");
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

  it("mounts the git-backed Routines list and keeps legacy step_functions routine detail URLs as redirects", () => {
    // The list route is now the real deterministic Routines page.
    expect(routineListRoute).toContain("SettingsRoutines");
    expect(routineListRoute).not.toContain("redirect({");
    // step_functions routine detail/execution URLs still fall back to the
    // Workflows surface.
    expect(routineDetailRoute).toContain("RoutineWorkflowDetailRedirect");
    expect(routineExecutionRoute).toContain("RoutineWorkflowRunRedirect");
  });
});
