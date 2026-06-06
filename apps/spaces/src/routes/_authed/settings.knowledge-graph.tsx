import { createFileRoute } from "@tanstack/react-router";
import { SettingsKnowledgeGraph } from "@/components/settings/SettingsKnowledgeGraph";

export const Route = createFileRoute("/_authed/settings/knowledge-graph")({
  component: SettingsKnowledgeGraph,
});
