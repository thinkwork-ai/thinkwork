import { createFileRoute } from "@tanstack/react-router";
import { AgentDetailChrome } from "@/components/agents/AgentDetailChrome";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";

export const Route = createFileRoute(
  "/_authed/_tenant/agents/$agentId_/editor",
)({
  component: AgentEditorPage,
  validateSearch: (search: Record<string, unknown>) => ({
    folder: (search.folder as string) || undefined,
  }),
});

function AgentEditorPage() {
  const { agentId } = Route.useParams();
  const { folder } = Route.useSearch();

  return (
    <AgentDetailChrome agentId={agentId} activeTab="editor">
      {() => (
        <WorkspaceEditor
          target={{ agentId }}
          mode="agent"
          agentId={agentId}
          initialFolder={folder}
          className="min-h-[500px]"
        />
      )}
    </AgentDetailChrome>
  );
}
