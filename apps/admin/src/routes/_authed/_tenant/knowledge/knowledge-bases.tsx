import { createFileRoute } from "@tanstack/react-router";
import { KnowledgeBasesPage } from "../knowledge-bases/index";

export const Route = createFileRoute(
  "/_authed/_tenant/knowledge/knowledge-bases",
)({
  component: KnowledgeKnowledgeBasesPage,
});

function KnowledgeKnowledgeBasesPage() {
  return (
    <KnowledgeBasesPage
      embedded
      detailBase="/knowledge/knowledge-bases/$kbId"
      breadcrumbs={[
        { label: "Brain", href: "/knowledge/memory" },
        { label: "KBs" },
      ]}
    />
  );
}
