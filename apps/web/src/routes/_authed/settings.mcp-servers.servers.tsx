import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsMcpServers } from "@/components/settings/SettingsMcpServers";

// The merged MCP Servers tab — tenant-registered servers and plugin MCPs on
// one surface. Analyst data sources live on the sibling Data Sources tab
// (THINK-285). The section index (/settings/mcp-servers) is the Connections
// tab.
export const Route = createFileRoute("/_authed/settings/mcp-servers/servers")({
  component: () => (
    <OperatorGuard>
      <SettingsMcpServers />
    </OperatorGuard>
  ),
});
