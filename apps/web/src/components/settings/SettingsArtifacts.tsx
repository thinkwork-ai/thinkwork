import { useCallback, useState } from "react";
import { Palette, Plus } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { ArtifactsListBody } from "@/components/artifacts/ArtifactsListBody";
import {
  PlatesListBody,
  type PlatesActionsController,
} from "@/components/artifacts/plates/PlatesListBody";
import { SetAppStyleButton } from "@/components/artifacts/SetAppStyleDialog";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

/**
 * The Artifacts settings surface: the artifact list and the plate registry
 * (THINK-153) as sibling header tabs, route-driven so each is deep-linkable —
 * the same pattern as the Memory page. The routes are OperatorGuard-wrapped,
 * so everything here is already operator-only.
 */
export const SETTINGS_ARTIFACTS_TABS = [
  { to: "/settings/artifacts", label: "Artifacts" },
  { to: "/settings/artifacts/plates", label: "Plates" },
];

export function SettingsArtifacts() {
  usePageHeaderActions({
    title: "Artifacts",
    breadcrumbs: [{ label: "Artifacts" }],
    tabs: SETTINGS_ARTIFACTS_TABS,
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

/** The Plates tab: registry list + preview, header-driven operator actions. */
export function SettingsArtifactsPlates() {
  const [controller, setController] = useState<PlatesActionsController | null>(
    null,
  );
  const updateController = useCallback(
    (next: PlatesActionsController | null) => setController(next),
    [],
  );

  usePageHeaderActions({
    title: "Artifacts",
    breadcrumbs: [{ label: "Artifacts" }],
    tabs: SETTINGS_ARTIFACTS_TABS,
    action: controller ? (
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          aria-label="Tenant palette"
          title="Tenant palette"
          onClick={() => controller.openPalette()}
          data-testid="plates-tenant-palette"
        >
          <Palette className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
          aria-label="New plate"
          title="New plate"
          onClick={() => controller.openCreate()}
          data-testid="plates-new"
        >
          <Plus className="size-4" />
        </Button>
      </div>
    ) : null,
    actionKey: `settings-artifacts-plates:${controller ? "ready" : "idle"}`,
  });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-6 pt-6">
        <SettingsPageTitle
          title="Plates"
          description="The document genres agents can produce — platform library plus this workspace's own plates."
        />
      </div>
      <PlatesListBody onActionsControllerChange={updateController} />
    </div>
  );
}
