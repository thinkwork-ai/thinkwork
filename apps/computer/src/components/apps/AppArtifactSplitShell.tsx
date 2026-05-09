import type { ReactNode } from "react";
import { AppCanvasPanel } from "@/components/apps/AppCanvasPanel";

interface AppArtifactSplitShellProps {
  children: ReactNode;
}

export function AppArtifactSplitShell({
  children,
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
        <AppCanvasPanel>{children}</AppCanvasPanel>
      </div>
    </div>
  );
}
