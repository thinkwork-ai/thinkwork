import { ArtifactsListBody } from "@/components/artifacts/ArtifactsListBody";
import { SetAppStyleButton } from "@/components/artifacts/SetAppStyleDialog";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

/**
 * Operator Artifacts console in Settings: the tenant-wide applet list (with the
 * operator user-ID filter) plus the "Set App Style" action. This is the
 * discoverable home for the operator tooling ported from the deprecated admin
 * Artifacts page. The route is OperatorGuard-wrapped, so everything here is
 * already operator-only.
 */
export function SettingsArtifacts() {
  usePageHeaderActions({
    title: "Artifacts",
    breadcrumbs: [{ label: "Artifacts" }],
    action: <SetAppStyleButton />,
    actionKey: "settings-artifacts-app-style",
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ArtifactsListBody
        detailPathFor={(id) => `/settings/artifacts/${id}`}
        headerSlot={
          <SettingsPageTitle
            title="Artifacts"
            description="Browse and manage the apps and artifacts generated in this Space."
          />
        }
      />
    </div>
  );
}
