import { createFileRoute } from "@tanstack/react-router";
import { AgentBuilderShell } from "@/components/agent-builder/AgentBuilderShell";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";

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

  useBreadcrumbs([
    { label: "Agents", href: "/agents" },
    { label: "Agent", href: `/agents/${agentId}` },
    { label: "Builder" },
  ]);

  return <AgentBuilderShell agentId={agentId} initialFolder={folder} />;
}
