import { AppCanvasPanel } from "@/components/apps/AppCanvasPanel";
import { AppTopBar } from "@/components/apps/AppTopBar";
import { AppTranscriptPanel } from "@/components/apps/AppTranscriptPanel";
import type { DashboardArtifactManifest } from "@/lib/app-artifacts";

interface AppArtifactSplitShellProps {
  manifest: DashboardArtifactManifest;
}

export function AppArtifactSplitShell({ manifest }: AppArtifactSplitShellProps) {
  return (
    <div className="flex h-svh min-h-0 flex-col bg-background text-foreground">
      <AppTopBar title={manifest.snapshot.title} />
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
        <AppTranscriptPanel manifest={manifest} />
        <AppCanvasPanel manifest={manifest} />
      </div>
    </div>
  );
}
