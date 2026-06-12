import { createFileRoute } from "@tanstack/react-router";
import { SettingsMainAgent } from "@/components/workspace-settings/SettingsMainAgent";

// Settings → Main Agent: S3-backed editor over the tenant Agent source (the
// baseline AGENTS.md plus its skills/ and agents/ folders). One of the four
// scoped editors that replaced the consolidated /settings/local-workspace
// page — the others live on the Agents, per-Space, and per-user settings
// surfaces. Editing is gated to owner/admin inside the view; everyone else
// sees the files read-only, so the route itself is not operator-guarded.
export const Route = createFileRoute("/_authed/settings/main-agent")({
  validateSearch: (search: Record<string, unknown>): { file?: string } => ({
    file: isSafeWorkspaceFile(search.file) ? search.file : undefined,
  }),
  component: MainAgentRoute,
});

function MainAgentRoute() {
  const { file } = Route.useSearch();
  return <SettingsMainAgent defaultOpenFile={file} />;
}

function isSafeWorkspaceFile(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  return Boolean(clean) && !clean.split("/").some((part) => part === "..");
}
