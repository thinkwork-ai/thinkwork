import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "@/docs/DocsPage";

/**
 * Agent Documentation home (THINK-693). Authed but chromeless on purpose:
 * docs open in their own tab from the account menu, so the route sits under
 * `_authed` as a sibling of `_shell` and carries no app navigation. The docs
 * shell supplies its own nav.
 */
export const Route = createFileRoute("/_authed/docs/")({
  component: DocsPage,
});
