import type { ReactNode } from "react";
import {
  Artifact,
  ArtifactContent,
} from "@/components/ai-elements/artifact";
import {
  GeneratedAppArtifactShell,
} from "@/components/apps/GeneratedAppArtifactShell";
import {
  GENERATED_APP_RUNTIME_MODE,
  type AppArtifactRuntimeMode,
} from "@/lib/app-artifacts";

interface AppCanvasPanelProps {
  children: ReactNode;
  title?: string;
  runtimeMode?: AppArtifactRuntimeMode;
  /**
   * Optional artifact chrome — when provided, the canvas renders
   * <ArtifactHeader> / <ArtifactActions> ahead of the content.
   * Plan-012 U12. Most callers don't supply this yet; the chrome is a
   * progressive enhancement and safe to omit.
   */
  chrome?: ReactNode;
}

export function AppCanvasPanel({
  children,
  title = "Generated app",
  runtimeMode = GENERATED_APP_RUNTIME_MODE,
  chrome,
}: AppCanvasPanelProps) {
  return (
    <section
      data-testid="app-canvas-panel"
      className="h-full min-h-0 overflow-y-auto overflow-x-hidden bg-background"
    >
      <div className="h-full min-w-0 overflow-x-hidden">
        {/* Full-route apps use the generated App shell structurally, with
            its header hidden because the route top bar already owns title
            and actions. The legacy chrome path remains for callers that
            pass explicit Artifact chrome. */}
        {chrome ? (
          <Artifact className="h-full border-0 bg-transparent shadow-none">
            {chrome}
            <ArtifactContent className="h-full p-0">
              {children}
            </ArtifactContent>
          </Artifact>
        ) : (
          <GeneratedAppArtifactShell
            title={title}
            runtimeMode={runtimeMode}
            showHeader={false}
            className="h-full border-0 bg-transparent shadow-none"
            contentClassName="h-full p-0"
          >
            {children}
          </GeneratedAppArtifactShell>
        )}
      </div>
    </section>
  );
}
