import { createFileRoute } from "@tanstack/react-router";
import {
  MemoryPage,
  Route as LegacyMemoryRoute,
} from "../memory/index";

export const Route = createFileRoute("/_authed/_tenant/knowledge/memory")({
  component: KnowledgeMemoryPage,
  validateSearch: LegacyMemoryRoute.options.validateSearch,
});

function KnowledgeMemoryPage() {
  return (
    <MemoryPage
      routeBase="/knowledge/memory"
      embedded
      breadcrumbs={[
        { label: "Brain", href: "/knowledge/memory" },
        { label: "Memory" },
      ]}
    />
  );
}
