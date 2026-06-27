import { createFileRoute, useLocation } from "@tanstack/react-router";
import {
  WorkItemDetailPage,
  WorkItemDocumentPage,
} from "@/components/work-items/WorkItemDetailPage";
import { useTenant } from "@/context/TenantContext";

export const Route = createFileRoute("/_authed/_shell/work-items/$workItemId")(
  {
    component: WorkItemDetailRoute,
  },
);

function WorkItemDetailRoute() {
  const { workItemId } = Route.useParams();
  const { tenantId } = useTenant();
  const location = useLocation();
  const documentId = documentIdFromWorkItemPath(location.pathname);

  if (documentId) {
    return (
      <WorkItemDocumentPage
        tenantId={tenantId}
        workItemId={workItemId}
        documentId={documentId}
      />
    );
  }

  return <WorkItemDetailPage tenantId={tenantId} workItemId={workItemId} />;
}

function documentIdFromWorkItemPath(pathname: string) {
  const match = pathname.match(/\/work-items\/[^/]+\/documents\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
