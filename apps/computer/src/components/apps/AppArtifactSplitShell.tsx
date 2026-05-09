import { AppCanvasPanel } from "@/components/apps/AppCanvasPanel";
import { AppTopBar } from "@/components/apps/AppTopBar";
import { AppTranscriptPanel } from "@/components/apps/AppTranscriptPanel";
import type {
  DashboardArtifactManifest,
  DashboardArtifactRefreshTask,
} from "@/lib/app-artifacts";

interface AppArtifactSplitShellProps {
  manifest: DashboardArtifactManifest;
  latestRefreshTask?: DashboardArtifactRefreshTask | null;
  canRefresh?: boolean;
  onRefreshDashboardArtifact?: () => Promise<
    DashboardArtifactRefreshTask | null | undefined
  >;
  onRefreshSettled?: () => void;
}

export function AppArtifactSplitShell({
  manifest,
  latestRefreshTask,
  canRefresh,
  onRefreshDashboardArtifact,
  onRefreshSettled,
}: AppArtifactSplitShellProps) {
  return (
    <div
      data-testid="app-artifact-split-shell"
      className="flex h-svh min-h-0 flex-col bg-background text-foreground"
    >
      <AppTopBar title={manifest.snapshot.title} />
      <div
        data-testid="app-artifact-panels"
        className="grid min-h-0 flex-1 lg:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]"
      >
        <AppTranscriptPanel manifest={manifest} />
        <AppCanvasPanel
          manifest={manifest}
          latestRefreshTask={latestRefreshTask}
          canRefresh={canRefresh}
          onRefreshDashboardArtifact={onRefreshDashboardArtifact}
          onRefreshSettled={onRefreshSettled}
        />
      </div>
    </div>
  );
}
