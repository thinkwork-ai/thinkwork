import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsKnowledgeGraph } from "@/components/settings/SettingsKnowledgeGraph";

export const Route = createFileRoute("/_authed/settings/knowledge-graph")({
  component: () => (
    <OperatorGuard>
      <SettingsKnowledgeGraph />
    </OperatorGuard>
  ),
});
