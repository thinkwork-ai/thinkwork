import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "@/docs/DocsPage";

/**
 * One documentation page (THINK-693). Unknown slugs are NOT a 404 — the
 * shell falls back to the home card grid with a friendly banner, because a
 * stale bookmark should land somewhere useful.
 */
export const Route = createFileRoute("/_authed/docs/$slug")({
  component: DocsPage,
});
