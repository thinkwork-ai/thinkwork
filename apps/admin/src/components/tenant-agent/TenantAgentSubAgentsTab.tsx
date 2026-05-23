import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";

export function TenantAgentSubAgentsTab({ agentId }: { agentId: string }) {
  return (
    <WorkspaceEditor
      target={{ agentId }}
      mode="agent"
      agentId={agentId}
      initialFolder="subagents"
      className="min-h-[620px]"
    />
  );
}
