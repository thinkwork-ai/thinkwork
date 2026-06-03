import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsKnowledgeBaseDetail } from "@/components/settings/SettingsKnowledgeBaseDetail";

export const Route = createFileRoute("/_authed/settings/knowledge-bases/$kbId")(
  {
    component: () => (
      <OperatorGuard>
        <SettingsKnowledgeBaseDetail />
      </OperatorGuard>
    ),
  },
);
