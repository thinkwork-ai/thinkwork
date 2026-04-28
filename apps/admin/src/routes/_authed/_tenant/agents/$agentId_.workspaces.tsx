import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authed/_tenant/agents/$agentId_/workspaces",
)({
  component: AgentWorkspacesRedirect,
  validateSearch: (search: Record<string, unknown>) => ({
    folder: (search.folder as string) || undefined,
  }),
});

function AgentWorkspacesRedirect() {
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
