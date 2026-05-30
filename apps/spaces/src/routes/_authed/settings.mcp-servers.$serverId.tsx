import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsMcpServerDetail } from "@/components/settings/SettingsMcpServerDetail";

export const Route = createFileRoute("/_authed/settings/mcp-servers/$serverId")(
  {
    component: () => (
      <OperatorGuard>
        <SettingsMcpServerDetail />
      </OperatorGuard>
    ),
  },
);
