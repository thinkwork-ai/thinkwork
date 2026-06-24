import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { WorkItemsPage } from "@/components/work-items/WorkItemsPage";
import {
  parseWorkItemRouteSearch,
  type WorkItemRouteSearch,
} from "@/components/work-items/work-item-filters";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";

export const Route = createFileRoute("/_authed/_shell/work-items/")({
  validateSearch: parseWorkItemRouteSearch,
  component: WorkItemsRoute,
});

function WorkItemsRoute() {
  const { tenantId } = useTenant();
  const state = Route.useSearch();
  const navigate = useNavigate();

  usePageHeaderActions({
    title: "Work Items",
    documentTitle: "Work Items",
  });

  return (
    <WorkItemsPage
      tenantId={tenantId}
      state={state}
      onStateChange={(next) => {
        void navigate({
          to: "/work-items",
          search: normalizeRouteState(next),
          replace: true,
        });
      }}
    />
  );
}

function normalizeRouteState(state: WorkItemRouteSearch): WorkItemRouteSearch {
  return {
    ...state,
    view: state.view ?? "list",
    sort: state.sort ?? "updated",
  };
}
