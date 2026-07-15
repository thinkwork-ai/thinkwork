import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsMcpServers } from "@/components/settings/SettingsMcpServers";

// The Self-Acquired tab of the Connectors surface (governed autonomy U5) —
// capabilities agents self-admitted / self-promoted with no human, with
// provenance and one-click revoke. Operator-only.
export const Route = createFileRoute(
  "/_authed/settings/mcp-servers/self-acquired",
)({
  component: () => (
    <OperatorGuard>
      <SettingsMcpServers />
    </OperatorGuard>
  ),
});
