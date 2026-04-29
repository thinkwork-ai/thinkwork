import { createFileRoute } from "@tanstack/react-router";
import {
  Route as LegacyWikiRoute,
  WikiPage,
} from "../wiki/index";

export const Route = createFileRoute("/_authed/_tenant/knowledge/wiki")({
  component: KnowledgeWikiPage,
  validateSearch: LegacyWikiRoute.options.validateSearch,
});

function KnowledgeWikiPage() {
  return (
    <WikiPage
      routeBase="/knowledge/wiki"
      embedded
      breadcrumbs={[
        { label: "Knowledge", href: "/knowledge/memory" },
        { label: "Wiki" },
      ]}
    />
  );
}
