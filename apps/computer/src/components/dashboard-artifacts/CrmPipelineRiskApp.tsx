import type {
  DashboardArtifactManifest,
  DashboardArtifactRefreshTask,
} from "@/lib/app-artifacts";
import { CrmEvidenceDrawer } from "@/components/dashboard-artifacts/CrmEvidenceDrawer";
import { CrmOpportunityRiskTable } from "@/components/dashboard-artifacts/CrmOpportunityRiskTable";
import { CrmPipelineHeader } from "@/components/dashboard-artifacts/CrmPipelineHeader";
import { CrmPipelineKpiStrip } from "@/components/dashboard-artifacts/CrmPipelineKpiStrip";
import { CrmPipelineStageCharts } from "@/components/dashboard-artifacts/CrmPipelineStageCharts";
import { CrmProductLineExposure } from "@/components/dashboard-artifacts/CrmProductLineExposure";
import { CrmRefreshBar } from "@/components/dashboard-artifacts/CrmRefreshBar";
import { CrmSourceCoverage } from "@/components/dashboard-artifacts/CrmSourceCoverage";

interface CrmPipelineRiskAppProps {
  manifest: DashboardArtifactManifest;
  latestRefreshTask?: DashboardArtifactRefreshTask | null;
  canRefresh?: boolean;
  onRefreshDashboardArtifact?: () => Promise<
    DashboardArtifactRefreshTask | null | undefined
  >;
  onRefreshSettled?: () => void;
}

export function CrmPipelineRiskApp({
  manifest,
  latestRefreshTask,
  canRefresh,
  onRefreshDashboardArtifact,
  onRefreshSettled,
}: CrmPipelineRiskAppProps) {
  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1280px] gap-4">
      <CrmPipelineHeader manifest={manifest} />
      <CrmRefreshBar
        manifest={manifest}
        latestRefreshTask={latestRefreshTask}
        canRefresh={canRefresh}
        onRefresh={onRefreshDashboardArtifact}
        onRefreshSettled={onRefreshSettled}
      />
      <CrmPipelineKpiStrip manifest={manifest} />
      <div className="grid gap-4 xl:grid-cols-2">
        <CrmPipelineStageCharts manifest={manifest} />
        <CrmProductLineExposure manifest={manifest} />
      </div>
      <CrmOpportunityRiskTable manifest={manifest} />
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <CrmSourceCoverage manifest={manifest} />
        <CrmEvidenceDrawer manifest={manifest} />
      </div>
    </div>
  );
}
