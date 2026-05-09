import { createFileRoute } from "@tanstack/react-router";
import { CustomizeTabBody } from "@/components/customize/CustomizeTabBody";
import { WORKFLOWS_FIXTURE } from "@/components/customize/customize-fixtures";

export const Route = createFileRoute("/_authed/_shell/customize/workflows")({
  component: WorkflowsTab,
});

/**
 * v1 renders a fixture catalog. U6 swaps the fixture for real urql
 * queries against tenant_workflow_catalog + the caller's routine
 * bindings.
 */
function WorkflowsTab() {
  return (
    <CustomizeTabBody
      activeTab="/customize/workflows"
      items={WORKFLOWS_FIXTURE}
      searchPlaceholder="Search workflows…"
      emptyMessage="No workflows match your filters."
    />
  );
}
