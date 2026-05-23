import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";

export function TenantAgentWorkspaceTab({ agentId }: { agentId: string }) {
  return (
    <WorkspaceEditor
      target={{ agentId }}
      mode="agent"
      agentId={agentId}
      className="min-h-[620px]"
    />
  );
}
