import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsMemoryHome } from "@/components/settings/SettingsMemoryHome";

export const Route = createFileRoute("/_authed/settings/memory")({
  component: () => (
    <OperatorGuard>
      <SettingsMemoryHome />
    </OperatorGuard>
  ),
});
