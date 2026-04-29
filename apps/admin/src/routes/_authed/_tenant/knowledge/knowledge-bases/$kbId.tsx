import { createFileRoute } from "@tanstack/react-router";
import { KnowledgeBaseDetailPage } from "../../knowledge-bases/$kbId";

export const Route = createFileRoute(
  "/_authed/_tenant/knowledge/knowledge-bases/$kbId",
)({
  component: KnowledgeKnowledgeBaseDetailPage,
});

function KnowledgeKnowledgeBaseDetailPage() {
  return (
    <KnowledgeBaseDetailPage
      embedded
      listHref="/knowledge/knowledge-bases"
    />
  );
}
