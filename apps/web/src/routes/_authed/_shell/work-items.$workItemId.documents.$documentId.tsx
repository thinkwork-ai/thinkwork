import { createFileRoute } from "@tanstack/react-router";
import { WorkItemDocumentPage } from "@/components/work-items/WorkItemDetailPage";
import { useTenant } from "@/context/TenantContext";

export const Route = createFileRoute(
  "/_authed/_shell/work-items/$workItemId/documents/$documentId",
)({
  component: WorkItemDocumentRoute,
});

function WorkItemDocumentRoute() {
  const { workItemId, documentId } = Route.useParams();
  const { tenantId } = useTenant();
  return (
    <WorkItemDocumentPage
      tenantId={tenantId}
      workItemId={workItemId}
      documentId={documentId}
    />
  );
}
