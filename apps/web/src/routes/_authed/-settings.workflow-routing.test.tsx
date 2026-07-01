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
  it("exposes Workflows as the top-level settings surface instead of Routines", () => {
    expect(navSource).toContain('label: "Workflows"');
    expect(navSource).toContain('to: "/settings/workflows"');
    expect(navSource).not.toContain('label: "Routines"');
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

  it("keeps legacy routine URLs as compatibility redirects or fallbacks", () => {
    expect(routineListRoute).toContain("redirect({");
    expect(routineListRoute).toContain('to: "/settings/workflows"');
    expect(routineDetailRoute).toContain("RoutineWorkflowDetailRedirect");
    expect(routineExecutionRoute).toContain("RoutineWorkflowRunRedirect");
  });
});
