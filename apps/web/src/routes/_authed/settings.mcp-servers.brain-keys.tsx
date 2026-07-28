import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsMcpServers } from "@/components/settings/SettingsMcpServers";

// The Brain API Keys tab of the Connectors surface — `tkt_` bearer keys for
// the platform Company Brain MCP server. The raw key is shown once at
// creation; only its suffix stays visible. Operator-only.
export const Route = createFileRoute(
  "/_authed/settings/mcp-servers/brain-keys",
)({
  component: () => (
    <OperatorGuard>
      <SettingsMcpServers />
    </OperatorGuard>
  ),
});
