import { createFileRoute } from "@tanstack/react-router";
import { SettingsMcpServers } from "@/components/settings/SettingsMcpServers";

export const Route = createFileRoute("/_authed/settings/mcp-servers/")({
  component: SettingsMcpServers,
});
