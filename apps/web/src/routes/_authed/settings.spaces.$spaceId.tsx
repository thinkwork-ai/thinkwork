import { createFileRoute } from "@tanstack/react-router";
import { OperatorGuard } from "@/components/settings/OperatorGuard";
import { SettingsSpaceConfig } from "@/components/settings/SettingsSpaceConfig";

export type SettingsSpaceView = "workspace";

export type SettingsSpaceSearch = {
  /** `workspace` shows the Space source editor; absent = config view. */
  view?: SettingsSpaceView;
  /** Optional file to open when `view=workspace`. */
  file?: string;
};

export const Route = createFileRoute("/_authed/settings/spaces/$spaceId")({
  validateSearch: (search: Record<string, unknown>): SettingsSpaceSearch => ({
    view: search.view === "workspace" ? "workspace" : undefined,
    file: isSafeWorkspaceFile(search.file) ? search.file : undefined,
  }),
  component: () => (
    <OperatorGuard>
      <SettingsSpaceConfig />
    </OperatorGuard>
  ),
});

function isSafeWorkspaceFile(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const clean = value.trim();
  return Boolean(clean) && !clean.split("/").some((part) => part === "..");
}
