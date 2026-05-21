import type { ReactNode } from "react";
import { AppCanvasPanel } from "@/components/apps/AppCanvasPanel";
import type { AppArtifactRuntimeMode } from "@/lib/app-artifacts";

interface AppArtifactSplitShellProps {
  children: ReactNode;
  title?: string;
  runtimeMode?: AppArtifactRuntimeMode;
}

export function AppArtifactSplitShell({
  children,
  title,
  runtimeMode,
}: AppArtifactSplitShellProps) {
  return (
    <div
      data-testid="app-artifact-split-shell"
      className="flex h-svh min-h-0 flex-col bg-background text-foreground"
    >
      <div
        data-testid="app-artifact-panels"
        className="min-h-0 min-w-0 flex-1"
      >
        <AppCanvasPanel title={title} runtimeMode={runtimeMode}>
          {children}
        </AppCanvasPanel>
      </div>
    </div>
  );
}
