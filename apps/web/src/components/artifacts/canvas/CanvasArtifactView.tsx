import { useCallback, useMemo, useState } from "react";
import { useMutation } from "urql";
import { toast } from "sonner";
import { Pin, RefreshCw } from "lucide-react";
import { Badge, Button } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import {
  PinArtifactMutation,
  RefreshCanvasDataMutation,
} from "@/lib/graphql-queries";
import { ThreadJsonRenderRenderer } from "@/components/workbench/json-render/ThreadJsonRenderRenderer";
import { BoundWidgetChrome } from "./BoundWidgetChrome";
import {
  CanvasVersionHistory,
  type CanvasVersion,
} from "./CanvasVersionHistory";
import { SaveCanvasDialog } from "./SaveCanvasDialog";
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
 * Living Artifacts (THINK-145 U10): the canvas artifact surface — the canvas
 * itself plus its living chrome: freshness badges + provenance + refresh on
 * bound widgets (R5/R8/R9), save/pin affordances (R10/R11), and version
 * history (R11). Draft canvases (no space) get a Save dialog; saved canvases
 * get Pin + a data-refresh control.
 */
export function CanvasArtifactView({
  artifact,
  onChanged,
}: {
  artifact: CanvasArtifactNode;
  /** Re-run the detail query so badges/versions reflect the latest server state. */
  onChanged: () => void;
}) {
  const { userId } = useTenant();
  const part = useMemo(
    () => parseLivingCanvasPart(artifact.content),
    [artifact.content],
  );
  const bindings = useMemo(() => artifact.bindings ?? [], [artifact.bindings]);
  const versions = artifact.versions ?? [];
  const isDraft = artifact.status?.toLowerCase() === "draft";

  const [{ fetching: pinning }, pinArtifact] = useMutation(PinArtifactMutation);
  const [, refreshCanvasData] = useMutation(RefreshCanvasDataMutation);
  const [refreshingBindingIds, setRefreshingBindingIds] = useState<Set<string>>(
    new Set(),
  );
  const [refreshingAll, setRefreshingAll] = useState(false);

  const runRefresh = useCallback(
    async (partId: string | undefined, bindingIds: string[]) => {
      setRefreshingBindingIds((current) => {
        const next = new Set(current);
        bindingIds.forEach((id) => next.add(id));
        return next;
      });
      try {
        const result = await refreshCanvasData({
          artifactId: artifact.id,
          partId: partId ?? null,
        });
        const payload = result.data?.refreshCanvasData;
        if (result.error || payload?.dispatched === false) {
          toast.error(
            `Refresh failed: ${
              result.error?.message ?? payload?.errorMessage ?? "unknown error"
            }`,
          );
        } else {
          const needsUser = (payload?.bindings ?? []).some(
            (b: { outcome?: string }) => b.outcome === "NEEDS_USER",
          );
          toast[needsUser ? "info" : "success"](
            needsUser
              ? "Some widgets need your connection to refresh in a thread."
              : "Canvas data refreshed.",
          );
        }
      } finally {
        setRefreshingBindingIds((current) => {
          const next = new Set(current);
          bindingIds.forEach((id) => next.delete(id));
          return next;
        });
        onChanged();
      }
    },
    [artifact.id, onChanged, refreshCanvasData],
  );

  const handleRefreshAll = useCallback(async () => {
    setRefreshingAll(true);
    try {
      await runRefresh(
        undefined,
        bindings.map((b) => b.id),
      );
    } finally {
      setRefreshingAll(false);
    }
  }, [bindings, runRefresh]);

  const handleRefreshBinding = useCallback(
    (binding: CanvasBinding) => {
      // Refreshing by partId re-runs every binding on that part, so mark them
      // all REFRESHING (R8) — not just the one whose control was clicked.
      const samePartIds = bindings
        .filter((b) => b.partId === binding.partId)
        .map((b) => b.id);
      void runRefresh(
        binding.partId,
        samePartIds.length ? samePartIds : [binding.id],
      );
    },
    [bindings, runRefresh],
  );

  const handlePin = useCallback(async () => {
    const result = await pinArtifact({ artifactId: artifact.id });
    if (result.error || !result.data?.pinArtifact?.id) {
      toast.error(
        `Couldn't pin version: ${result.error?.message ?? "unknown error"}`,
      );
      return;
    }
    toast.success(`Pinned version ${result.data.pinArtifact.headVersion}`);
    onChanged();
  }, [artifact.id, onChanged, pinArtifact]);

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-4 p-4 sm:p-6">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Canvas
          </p>
          {isDraft ? (
            <Badge variant="outline" data-testid="canvas-draft-badge">
              Draft
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid="canvas-version-indicator">
              v{artifact.headVersion}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {bindings.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshingAll}
              onClick={() => void handleRefreshAll()}
              data-testid="canvas-refresh-all"
            >
              <RefreshCw
                className={`size-4 ${refreshingAll ? "animate-spin" : ""}`}
              />
              Refresh data
            </Button>
          ) : null}
          {isDraft ? (
            <SaveCanvasDialog
              artifactId={artifact.id}
              defaultTitle={artifact.title}
              onSaved={() => onChanged()}
            />
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={pinning}
              onClick={() => void handlePin()}
              data-testid="canvas-pin"
            >
              <Pin className="size-4" />
              {pinning ? "Pinning…" : "Pin version"}
            </Button>
          )}
        </div>
      </section>

      {artifact.summary ? (
        <p className="text-sm text-muted-foreground">{artifact.summary}</p>
      ) : null}

      <BoundWidgetChrome
        bindings={bindings}
        currentUserId={userId ?? null}
        refreshingBindingIds={refreshingBindingIds}
        onRefresh={handleRefreshBinding}
      />

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
