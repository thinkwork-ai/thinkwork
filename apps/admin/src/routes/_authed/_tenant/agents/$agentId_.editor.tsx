import { createFileRoute } from "@tanstack/react-router";
import { AgentDetailChrome } from "@/components/agents/AgentDetailChrome";
import {
  AGENT_WORKSPACE_DEFAULT_FILES,
  WorkspaceEditor,
} from "@/components/agent-builder/WorkspaceEditor";

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
      {({ agent }) => (
        <WorkspaceEditor
          target={{ agentId }}
          mode="agent"
          agentId={agentId}
          agentSlug={agent?.slug ?? undefined}
          initialFolder={folder}
          bootstrapFiles={AGENT_WORKSPACE_DEFAULT_FILES}
          bootstrapLabel="Create Default Files"
          className="min-h-[500px]"
        />
      )}
    </AgentDetailChrome>
  );
}
