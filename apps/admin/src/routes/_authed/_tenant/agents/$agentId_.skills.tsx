import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authed/_tenant/agents/$agentId_/skills",
)({
  component: AgentSkillsRedirect,
});

function AgentSkillsRedirect() {
  const { agentId } = Route.useParams();
  return (
    <Navigate
      to="/agents/$agentId/workspace"
      params={{ agentId }}
      search={{ folder: undefined }}
    />
  );
}
