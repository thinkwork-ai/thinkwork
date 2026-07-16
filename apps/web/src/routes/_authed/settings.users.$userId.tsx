import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsUserDetail } from "@/components/settings/SettingsUserDetail";

export type SettingsUserView = "workspace";

export type SettingsUserSearch = {
  /** `workspace` shows the user's source editor; absent = detail view. */
  view?: SettingsUserView;
  /** Optional file to open when `view=workspace`. */
  file?: string;
};

export const Route = createFileRoute("/_authed/settings/users/$userId")({
  validateSearch: (search: Record<string, unknown>): SettingsUserSearch => ({
    view: search.view === "workspace" ? "workspace" : undefined,
    file: isSafeWorkspaceFile(search.file) ? search.file : undefined,
  }),
  component: () => (
    <OperatorGuard>
      <SettingsUserDetail />
    </OperatorGuard>
  ),
});

function isSafeWorkspaceFile(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  return Boolean(clean) && !clean.split("/").some((part) => part === "..");
}
