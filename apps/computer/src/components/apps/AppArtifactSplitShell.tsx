import { AppCanvasPanel } from "@/components/apps/AppCanvasPanel";
import { AppTopBar } from "@/components/apps/AppTopBar";
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
        className="min-h-0 min-w-0 flex-1"
      >
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
