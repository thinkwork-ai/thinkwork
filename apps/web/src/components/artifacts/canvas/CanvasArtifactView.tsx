import { useMemo } from "react";
import { ThreadJsonRenderRenderer } from "@/components/workbench/json-render/ThreadJsonRenderRenderer";
import {
  CanvasVersionHistory,
  type CanvasVersion,
} from "./CanvasVersionHistory";
import { parseLivingCanvasPart } from "./canvas-content";
import type { CanvasBinding } from "./binding-display";

export interface CanvasArtifactNode {
  id: string;
  title: string;
  status: string;
  spaceId?: string | null;
  headVersion: number;
  content?: string | null;
  summary?: string | null;
  bindings?: CanvasBinding[] | null;
  versions?: CanvasVersion[] | null;
}

/**
 * Living Artifacts (THINK-145 U10): the canvas artifact surface. Deliberately
 * chrome-free — just the rendered canvas plus version history. Save/Pin/
 * Refresh live in the page header ({@link ../../routes} composes
 * `CanvasHeaderActions`); the per-widget data-sources strip was removed as
 * ceremony (freshness/provenance stays available through the agent tools).
 */
export function CanvasArtifactView({
  artifact,
}: {
  artifact: CanvasArtifactNode;
}) {
  const part = useMemo(
    () => parseLivingCanvasPart(artifact.content),
    [artifact.content],
  );
  const versions = artifact.versions ?? [];

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-4 p-4 sm:p-6">
      {part ? (
        <section className="grid gap-3" data-testid="canvas-render">
          <ThreadJsonRenderRenderer data={part.data} partId={part.id} />
        </section>
      ) : (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          This canvas has no readable payload.
        </p>
      )}

      <CanvasVersionHistory
        artifactId={artifact.id}
        versions={versions}
        headVersion={artifact.headVersion}
      />
    </main>
  );
}
