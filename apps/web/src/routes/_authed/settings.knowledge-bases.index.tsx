import { createFileRoute, redirect } from "@tanstack/react-router";

// Knowledge Bases folded into the unified Memory page (Knowledge Bases tab).
// The per-knowledge-base detail route (`$kbId`) stays a standalone page.
export const Route = createFileRoute("/_authed/settings/knowledge-bases/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/memory" });
  },
});
