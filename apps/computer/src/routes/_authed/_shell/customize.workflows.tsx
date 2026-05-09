import { useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CustomizeTabBody } from "@/components/customize/CustomizeTabBody";
import { useWorkflowItems } from "@/components/customize/use-customize-data";
import { useWorkflowMutation } from "@/components/customize/use-customize-mutations";

export const Route = createFileRoute("/_authed/_shell/customize/workflows")({
  component: WorkflowsTab,
});

function WorkflowsTab() {
  const { items, fetching, error } = useWorkflowItems();
  const { toggle } = useWorkflowMutation();

  const handleAction = useCallback(
    (slug: string, nextConnected: boolean) => {
      void toggle(slug, nextConnected);
    },
    [toggle],
  );

  return (
    <CustomizeTabBody
      activeTab="/customize/workflows"
      items={items}
      onAction={handleAction}
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
