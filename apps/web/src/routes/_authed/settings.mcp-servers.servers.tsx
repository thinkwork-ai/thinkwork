import { createFileRoute, redirect } from "@tanstack/react-router";

// LEGACY PATH. MCP Servers moved to the section index (Eric 2026-08-13 —
// it is the default tab now); this route survives only so old links and
// bookmarks land somewhere real instead of 404ing.
export const Route = createFileRoute("/_authed/settings/mcp-servers/servers")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/mcp-servers" });
  },
});
