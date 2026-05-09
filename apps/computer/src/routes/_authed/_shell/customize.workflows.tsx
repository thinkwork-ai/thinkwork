import { createFileRoute } from "@tanstack/react-router";
import { CustomizeTabBody } from "@/components/customize/CustomizeTabBody";
import { useWorkflowItems } from "@/components/customize/use-customize-data";

export const Route = createFileRoute("/_authed/_shell/customize/workflows")({
  component: WorkflowsTab,
});

function WorkflowsTab() {
  const { items, fetching, error } = useWorkflowItems();
  return (
    <CustomizeTabBody
      activeTab="/customize/workflows"
      items={items}
      searchPlaceholder="Search workflows…"
      emptyMessage={
        error
          ? `Couldn't load workflows: ${error.message}`
          : fetching
            ? "Loading workflows…"
            : "No workflows match your filters."
      }
    />
  );
}
