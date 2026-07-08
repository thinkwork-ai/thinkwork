import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import {
  WORKFLOWS_TABS,
  WorkflowsIndexTabs,
  type WorkflowsTab,
} from "@/components/workflows/WorkflowsIndexTabs";

export type WorkflowsIndexSearch = { tab?: WorkflowsTab };

export const Route = createFileRoute("/_authed/settings/workflows/")({
  validateSearch: (search: Record<string, unknown>): WorkflowsIndexSearch => ({
    tab: WORKFLOWS_TABS.includes(search.tab as WorkflowsTab)
      ? (search.tab as WorkflowsTab)
      : undefined,
  }),
  component: WorkflowsIndexRoute,
});

function WorkflowsIndexRoute() {
  const { tab } = Route.useSearch();
  return (
    <OperatorGuard>
      <WorkflowsIndexTabs tab={tab ?? "workflows"} />
    </OperatorGuard>
  );
}
