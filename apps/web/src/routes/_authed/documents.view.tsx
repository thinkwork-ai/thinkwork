import { createFileRoute } from "@tanstack/react-router";
import { KnowledgeDocumentViewer } from "@/components/documents/KnowledgeDocumentViewer";

/**
 * In-app document viewer for cited knowledge documents — Office formats
 * the browser can't render natively open here (new tab) instead of
 * downloading. Authed but chromeless on purpose: a document tab is a
 * focused artifact, so it sits under _authed as a sibling of _shell and
 * carries no app navigation.
 */
export const Route = createFileRoute("/_authed/documents/view")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { src?: string; key?: string; page?: number } => ({
    ...(typeof search.src === "string" && search.src
      ? { src: search.src }
      : {}),
    ...(typeof search.key === "string" && search.key
      ? { key: search.key }
      : {}),
    ...(Number.isFinite(Number(search.page)) && Number(search.page) > 0
      ? { page: Number(search.page) }
      : {}),
  }),
  component: DocumentViewRoute,
});

function DocumentViewRoute() {
  const { src, key, page } = Route.useSearch();
  return <KnowledgeDocumentViewer src={src} documentKey={key} page={page} />;
}
