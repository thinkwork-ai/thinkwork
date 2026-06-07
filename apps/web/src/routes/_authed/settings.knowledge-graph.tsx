import { createFileRoute, redirect } from "@tanstack/react-router";

// Knowledge Graph explorer folded into the unified Memory page (Knowledge Graph
// tab). Cognee's deployment config now lives at Applications > Cognee.
export const Route = createFileRoute("/_authed/settings/knowledge-graph")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/memory" });
  },
});
