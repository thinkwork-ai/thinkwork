import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsMcpServers } from "@/components/settings/SettingsMcpServers";

// The Data Sources tab of the Connectors surface (THINK-285) — analyst data
// sources on their own tab. Old bookmarks to this path land here directly.
export const Route = createFileRoute(
  "/_authed/settings/mcp-servers/data-sources",
)({
  component: () => (
    <OperatorGuard>
      <SettingsMcpServers />
    </OperatorGuard>
  ),
});
