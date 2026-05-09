import type { ReactNode } from "react";

interface AppCanvasPanelProps {
  children: ReactNode;
}

export function AppCanvasPanel({ children }: AppCanvasPanelProps) {
  return (
    <section
      data-testid="app-canvas-panel"
      className="min-h-0 overflow-y-auto overflow-x-hidden bg-muted/20 px-3 py-4 sm:px-6 sm:py-6"
    >
      <div className="mx-auto min-w-0 max-w-[1280px] overflow-x-hidden">
        {children}
      </div>
    </section>
  );
}
