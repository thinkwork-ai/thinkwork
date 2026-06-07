import type { ReactNode } from "react";
import { cn } from "@thinkwork/ui";
import { AppCanvasPanel } from "@/components/apps/AppCanvasPanel";
import type { AppArtifactRuntimeMode } from "@/lib/app-artifacts";

interface AppArtifactSplitShellProps {
  children: ReactNode;
  title?: string;
  runtimeMode?: AppArtifactRuntimeMode;
  /**
   * Fill the parent container (`h-full`) instead of the viewport (`h-svh`).
   * Used when the detail is embedded inside the Settings shell rather than
   * rendered as a full-screen takeover from the main app shell.
   */
  fill?: boolean;
}

export function AppArtifactSplitShell({
  children,
  title,
  runtimeMode,
  fill = false,
}: AppArtifactSplitShellProps) {
  return (
    <div
      data-testid="app-artifact-split-shell"
      className={cn(
        "flex min-h-0 flex-col bg-background text-foreground",
        fill ? "h-full" : "h-svh",
      )}
    >
      <div data-testid="app-artifact-panels" className="min-h-0 min-w-0 flex-1">
        <AppCanvasPanel title={title} runtimeMode={runtimeMode}>
          {children}
        </AppCanvasPanel>
      </div>
    </div>
  );
}
