import type { ReactNode } from "react";
import {
  Artifact,
  ArtifactContent,
} from "@/components/ai-elements/artifact";

interface AppCanvasPanelProps {
  children: ReactNode;
  /**
   * Optional artifact chrome — when provided, the canvas renders
   * <ArtifactHeader> / <ArtifactActions> ahead of the content.
   * Plan-012 U12. Most callers don't supply this yet; the chrome is a
   * progressive enhancement and safe to omit.
   */
  chrome?: ReactNode;
}

export function AppCanvasPanel({ children, chrome }: AppCanvasPanelProps) {
  return (
    <section
      data-testid="app-canvas-panel"
      className="min-h-0 overflow-y-auto overflow-x-hidden bg-muted/20 px-3 py-4 sm:px-6 sm:py-6"
    >
      <div className="mx-auto min-w-0 max-w-[1280px] overflow-x-hidden">
        {/* Plan-012 U12: AI Elements <Artifact> chrome wraps the canvas
            content. With no chrome prop the bordered container collapses
            (className overrides remove the border / shadow / background)
            so existing applet routes stay visually unchanged; supplying
            chrome lights up the header + actions row. Either way the
            ArtifactContent wrapper is present so future stylesheet
            passes can target it consistently. */}
        <Artifact className="border-0 bg-transparent shadow-none">
          {chrome}
          <ArtifactContent className="p-0">{children}</ArtifactContent>
        </Artifact>
      </div>
    </section>
  );
}
