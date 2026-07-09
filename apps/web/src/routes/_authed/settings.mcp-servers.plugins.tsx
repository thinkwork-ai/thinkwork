import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsMcpServers } from "@/components/settings/SettingsMcpServers";

export const Route = createFileRoute("/_authed/settings/mcp-servers/plugins")({
  component: () => (
    <OperatorGuard>
      <SettingsMcpServers />
    </OperatorGuard>
  ),
});
