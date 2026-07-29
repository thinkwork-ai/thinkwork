import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsMemory } from "@/components/settings/SettingsMemory";

export const Route = createFileRoute("/_authed/settings/memory")({
  component: () => (
    <OperatorGuard>
      <SettingsMemory />
    </OperatorGuard>
  ),
});
