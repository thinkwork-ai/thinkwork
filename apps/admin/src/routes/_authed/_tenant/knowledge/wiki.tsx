import { createFileRoute } from "@tanstack/react-router";
import { Route as LegacyWikiRoute, WikiPage } from "../wiki/index";
import { useKnowledgeHeaderAction } from "./-header-actions";

export const Route = createFileRoute("/_authed/_tenant/knowledge/wiki")({
  component: KnowledgeWikiPage,
  validateSearch: LegacyWikiRoute.options.validateSearch,
});

function KnowledgeWikiPage() {
  const setHeaderAction = useKnowledgeHeaderAction();

  return (
    <WikiPage
      routeBase="/knowledge/wiki"
      embedded
      onHeaderActionChange={setHeaderAction ?? undefined}
      breadcrumbs={[
        { label: "Memory", href: "/knowledge/memory" },
        { label: "Pages" },
      ]}
    />
  );
}
