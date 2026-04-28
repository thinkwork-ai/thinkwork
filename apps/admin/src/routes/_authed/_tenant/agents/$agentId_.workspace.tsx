import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authed/_tenant/agents/$agentId_/workspace",
)({
  component: AgentWorkspacePage,
  validateSearch: (search: Record<string, unknown>) => ({
    folder: (search.folder as string) || undefined,
  }),
});

function AgentWorkspacePage() {
  const { agentId } = Route.useParams();
  const { folder } = Route.useSearch();

  return (
    <Navigate
      to="/agents/$agentId/editor"
      params={{ agentId }}
      search={{ folder }}
    />
  );
}
