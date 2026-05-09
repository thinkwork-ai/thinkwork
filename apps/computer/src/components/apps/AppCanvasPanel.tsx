import type {
  DashboardArtifactManifest,
  DashboardArtifactRefreshTask,
} from "@/lib/app-artifacts";
import { CrmPipelineRiskApp } from "@/components/dashboard-artifacts/CrmPipelineRiskApp";

interface AppCanvasPanelProps {
  manifest: DashboardArtifactManifest;
  latestRefreshTask?: DashboardArtifactRefreshTask | null;
  canRefresh?: boolean;
  onRefreshDashboardArtifact?: () => Promise<
    DashboardArtifactRefreshTask | null | undefined
  >;
  onRefreshSettled?: () => void;
}

export function AppCanvasPanel({
  manifest,
  latestRefreshTask,
  canRefresh,
  onRefreshDashboardArtifact,
  onRefreshSettled,
}: AppCanvasPanelProps) {
  return (
    <section
      data-testid="app-canvas-panel"
      className="min-h-0 overflow-y-auto overflow-x-hidden bg-muted/20 px-3 py-4 sm:px-6 sm:py-6"
    >
      {manifest.dashboardKind === "pipeline_risk" ? (
        <CrmPipelineRiskApp
          manifest={manifest}
          latestRefreshTask={latestRefreshTask}
          canRefresh={canRefresh}
          onRefreshDashboardArtifact={onRefreshDashboardArtifact}
          onRefreshSettled={onRefreshSettled}
        />
      ) : (
        <div className="mx-auto w-full max-w-[1280px] rounded-lg border border-border/70 bg-background p-6 text-sm text-muted-foreground">
          Unsupported dashboard kind: {manifest.dashboardKind}
        </div>
      )}
    </section>
  );
}
