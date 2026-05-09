import type { ReactNode } from "react";
import { AppCanvasPanel } from "@/components/apps/AppCanvasPanel";
import { AppTopBar } from "@/components/apps/AppTopBar";

interface AppArtifactSplitShellProps {
  title: string;
  children: ReactNode;
}

export function AppArtifactSplitShell({
  title,
  children,
}: AppArtifactSplitShellProps) {
  return (
    <div
      data-testid="app-artifact-split-shell"
      className="flex h-svh min-h-0 flex-col bg-background text-foreground"
    >
      <AppTopBar title={title} />
      <div
        data-testid="app-artifact-panels"
        className="min-h-0 min-w-0 flex-1"
      >
        <AppCanvasPanel>{children}</AppCanvasPanel>
      </div>
    </div>
  );
}
