import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { ContextDiagnosticsPage } from "@/components/settings/brain/BrainOperationsPage";

export const Route = createFileRoute("/_authed/settings/context-diagnostics")({
  component: () => (
    <OperatorGuard>
      <ContextDiagnosticsPage />
    </OperatorGuard>
  ),
});
