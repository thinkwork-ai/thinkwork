import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";

export function TenantAgentSkillsTab() {
  return (
    <WorkspaceEditor
      target={{ catalog: true }}
      mode="catalog"
      className="min-h-[620px]"
    />
  );
}
