import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsMcpServers } from "@/components/settings/SettingsMcpServers";

// The merged MCP Servers tab — tenant-registered servers, plugin MCPs, and
// analyst data sources on one surface. The section index
// (/settings/mcp-servers) is the Connections tab.
export const Route = createFileRoute("/_authed/settings/mcp-servers/servers")({
  component: () => (
    <OperatorGuard>
      <SettingsMcpServers />
    </OperatorGuard>
  ),
});
