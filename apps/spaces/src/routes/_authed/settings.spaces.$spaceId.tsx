import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsSpaceConfig } from "@/components/settings/SettingsSpaceConfig";

export const Route = createFileRoute("/_authed/settings/spaces/$spaceId")({
  component: () => (
    <OperatorGuard>
      <SettingsSpaceConfig />
    </OperatorGuard>
  ),
});
