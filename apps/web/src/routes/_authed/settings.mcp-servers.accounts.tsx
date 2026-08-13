import { createFileRoute } from "@tanstack/react-router";
import { SettingsMcpServers } from "@/components/settings/SettingsMcpServers";

// Linked Accounts — the per-user integrations surface (Eric 2026-08-13:
// renamed from "Connections", and the section index is MCP Servers now).
// No operator guard: every member links their own accounts.
export const Route = createFileRoute("/_authed/settings/mcp-servers/accounts")(
  {
    component: SettingsMcpServers,
  },
);
