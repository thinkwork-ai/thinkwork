import { createFileRoute } from "@tanstack/react-router";
import { ManagedApplicationRouteGuard } from "@/components/settings/ManagedApplicationRouteGuard";
import { SettingsKnowledgeGraph } from "@/components/settings/SettingsKnowledgeGraph";

export const Route = createFileRoute("/_authed/settings/knowledge-graph")({
  component: () => (
    <ManagedApplicationRouteGuard appKey="cognee">
      <SettingsKnowledgeGraph />
    </ManagedApplicationRouteGuard>
  ),
});
