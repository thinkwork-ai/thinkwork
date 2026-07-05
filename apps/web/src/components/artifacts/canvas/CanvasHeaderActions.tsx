import { useCallback, useState } from "react";
import { useMutation } from "urql";
import { toast } from "sonner";
import { Pin, RefreshCw } from "lucide-react";
import { Button } from "@thinkwork/ui";
import {
  PinArtifactMutation,
  RefreshCanvasDataMutation,
} from "@/lib/graphql-queries";
import { SaveCanvasDialog } from "./SaveCanvasDialog";

/**
 * Header actions for a canvas artifact (THINK-145 declutter): muted icon
 * buttons in the page header instead of in-body chrome. Drafts get the Save
 * dialog; saved canvases get Refresh-data (when bindings exist) + Pin-version.
 */
export function CanvasHeaderActions({
  artifact,
  hasBindings,
  onChanged,
}: {
  artifact: { id: string; title: string; status: string };
  hasBindings: boolean;
  onChanged: () => void;
}) {
  const isDraft = artifact.status?.toLowerCase() === "draft";
  const [{ fetching: pinning }, pinArtifact] = useMutation(PinArtifactMutation);
  const [, refreshCanvasData] = useMutation(RefreshCanvasDataMutation);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await refreshCanvasData({
        artifactId: artifact.id,
        partId: null,
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
        if (needsUser) {
          toast.info("Ask the agent in a thread to refresh this canvas.");
        }
      }
    } finally {
      setRefreshing(false);
      onChanged();
    }
  }, [artifact.id, onChanged, refreshCanvasData]);

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

  if (isDraft) {
    return (
      <SaveCanvasDialog
        artifactId={artifact.id}
        defaultTitle={artifact.title}
        onSaved={() => onChanged()}
      />
    );
  }

  return (
    <>
      {hasBindings ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          title="Refresh data"
          aria-label="Refresh data"
          disabled={refreshing}
          onClick={() => void handleRefresh()}
          data-testid="canvas-refresh-all"
        >
          <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground"
        title="Pin version"
        aria-label="Pin version"
        disabled={pinning}
        onClick={() => void handlePin()}
        data-testid="canvas-pin"
      >
        <Pin className="size-4" />
      </Button>
    </>
  );
}
