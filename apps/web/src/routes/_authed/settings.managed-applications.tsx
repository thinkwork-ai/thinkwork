import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { ManagedApplicationsPage } from "@/components/settings/managed-applications/ManagedApplicationsPage";

export const Route = createFileRoute("/_authed/settings/managed-applications")({
  component: () => (
    <OperatorGuard>
      <ManagedApplicationsPage />
    </OperatorGuard>
  ),
});
