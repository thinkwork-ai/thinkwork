import { createFileRoute, redirect } from "@tanstack/react-router";

// The standalone Plugin MCPs tab merged into the unified MCP Servers tab —
// old bookmarks keep working via this redirect.
export const Route = createFileRoute("/_authed/settings/mcp-servers/plugins")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/mcp-servers/servers", replace: true });
  },
});
