import { createFileRoute, redirect } from "@tanstack/react-router";

// The consolidated Settings → Workspace editor is retired; its function is
// split across four scoped surfaces (Main Agent, Agents, per-Space, per-user).
// This route redirects to the Main Agent surface for one release before
// removal. Legacy `?file=` deep links that pointed into the Agent source carry
// over (with the old synthetic `Agent/` prefix stripped); links into the
// Spaces/User sources drop the param — those trees now live on the per-Space
// and per-user settings pages.
export const Route = createFileRoute("/_authed/settings/local-workspace")({
  validateSearch: (search: Record<string, unknown>): { file?: string } => ({
    file: typeof search.file === "string" ? search.file : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/settings/main-agent",
      search: { file: mapLegacyWorkspaceFile(search.file) },
      replace: true,
    });
  },
});

/**
 * Maps a legacy consolidated-tree path (`Agent/AGENTS.md`) to its Main Agent
 * source-relative equivalent (`AGENTS.md`). Returns undefined for paths in the
 * other sources (Spaces/, User/) and for unsafe or empty values — the redirect
 * then lands on the Main Agent surface with its default file.
 */
export function mapLegacyWorkspaceFile(
  file: string | undefined,
): string | undefined {
  if (!file) return undefined;
  const clean = file.trim().replace(/^\/+/, "");
  if (!clean.startsWith("Agent/")) return undefined;
  const logical = clean.slice("Agent/".length);
  if (!logical || logical.split("/").some((part) => part === "..")) {
    return undefined;
  }
  return logical;
}
