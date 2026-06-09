import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsModelCatalog } from "@/components/settings/SettingsModelCatalog";

export const Route = createFileRoute("/_authed/settings/model-catalog")({
  component: () => (
    <OperatorGuard>
      <SettingsModelCatalog />
    </OperatorGuard>
  ),
});
