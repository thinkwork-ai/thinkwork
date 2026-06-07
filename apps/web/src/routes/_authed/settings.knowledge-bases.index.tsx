import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsKnowledgeBases } from "@/components/settings/SettingsKnowledgeBases";

export const Route = createFileRoute("/_authed/settings/knowledge-bases/")({
  component: () => (
    <OperatorGuard>
      <SettingsKnowledgeBases />
    </OperatorGuard>
  ),
});
