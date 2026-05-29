import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsSpaces } from "@/components/settings/SettingsSpaces";

export const Route = createFileRoute("/_authed/settings/spaces")({
  component: () => (
    <OperatorGuard>
      <SettingsSpaces />
    </OperatorGuard>
  ),
});
