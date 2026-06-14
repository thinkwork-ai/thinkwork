import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { BrainOperationsPage } from "@/components/settings/brain/BrainOperationsPage";

export const Route = createFileRoute("/_authed/settings/brain-operations")({
  component: () => (
    <OperatorGuard>
      <BrainOperationsPage />
    </OperatorGuard>
  ),
});
