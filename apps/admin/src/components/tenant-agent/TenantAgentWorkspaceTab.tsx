import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";

export function TenantAgentWorkspaceTab({ agentId }: { agentId: string }) {
  return (
    <WorkspaceEditor
      target={{ agentId }}
      mode="agent"
      agentId={agentId}
      defaultOpenFile="AGENTS.md"
      className="min-h-[620px]"
    />
  );
}
