import { createFileRoute, redirect } from "@tanstack/react-router";

// The standalone Settings → Main Agent page is retired; the agent-source
// editor now lives on the Agents page as its workspace view
// (/settings/agents?view=workspace, toggled by the header icon). This route
// redirects there for one release before removal, carrying the ?file= deep
// link through so existing links keep opening the right file.
export const Route = createFileRoute("/_authed/settings/main-agent")({
  validateSearch: (search: Record<string, unknown>): { file?: string } => ({
    file: isSafeWorkspaceFile(search.file) ? search.file : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/settings/agents",
      search: { view: "workspace", file: search.file },
      replace: true,
    });
  },
});

function isSafeWorkspaceFile(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  return Boolean(clean) && !clean.split("/").some((part) => part === "..");
}
