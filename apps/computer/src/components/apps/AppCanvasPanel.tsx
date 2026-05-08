import type { DashboardArtifactManifest } from "@/lib/app-artifacts";
import { CrmPipelineRiskApp } from "@/components/dashboard-artifacts/CrmPipelineRiskApp";

interface AppCanvasPanelProps {
  manifest: DashboardArtifactManifest;
}

export function AppCanvasPanel({ manifest }: AppCanvasPanelProps) {
  return (
    <section className="min-h-0 overflow-auto bg-muted/20 p-4 sm:p-5">
      {manifest.dashboardKind === "pipeline_risk" ? (
        <CrmPipelineRiskApp manifest={manifest} />
      ) : (
        <div className="rounded-lg border border-border/70 bg-background p-6 text-sm text-muted-foreground">
          Unsupported dashboard kind: {manifest.dashboardKind}
        </div>
      )}
    </section>
  );
}
