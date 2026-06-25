import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { WorkItemsPage } from "@/components/work-items/WorkItemsPage";
import {
  parseWorkItemRouteSearch,
  workItemRouteSearchToParams,
  type WorkItemRouteSearch,
} from "@/components/work-items/work-item-filters";
import { useTenant } from "@/context/TenantContext";

export const Route = createFileRoute("/_authed/_shell/work-items/")({
  validateSearch: parseWorkItemRouteSearch,
  component: WorkItemsRoute,
});

function WorkItemsRoute() {
  const { tenantId } = useTenant();
  const state = Route.useSearch();
  const navigate = useNavigate();

  return (
    <WorkItemsPage
      tenantId={tenantId}
      state={state}
      onStateChange={(next) => {
        void navigate({
          to: "/work-items",
          search: workItemRouteSearchToParams(
            next,
          ) as unknown as WorkItemRouteSearch,
          replace: true,
        });
      }}
    />
  );
}
