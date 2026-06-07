import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceSettingsView } from "@/components/workspace-settings/WorkspaceSettingsView";

// Settings → Workspace: a single, S3-backed editor spanning all three workspace
// sources (Agent / Spaces / User). Editing is gated to owner/admin; everyone
// else sees the files read-only. Available in any build (no longer desktop-only)
// because it reads and writes S3 through the workspace-files API. Return
// navigation is handled by the settings chrome (sidebar "Back to app" + header
// history controls). The route path is kept as `local-workspace` to avoid
// breaking existing deep links.
export const Route = createFileRoute("/_authed/settings/local-workspace")({
  validateSearch: (search: Record<string, unknown>): { file?: string } => ({
    file: isSafeWorkspaceFile(search.file) ? search.file : undefined,
  }),
  component: WorkspaceSettingsRoute,
});

function WorkspaceSettingsRoute() {
  const { file } = Route.useSearch();
  return <WorkspaceSettingsView defaultOpenFile={file} />;
}

function isSafeWorkspaceFile(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  return Boolean(clean) && !clean.split("/").some((part) => part === "..");
}
