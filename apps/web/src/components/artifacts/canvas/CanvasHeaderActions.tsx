import { useCallback, useState } from "react";
import { useClient, useMutation } from "urql";
import { toast } from "sonner";
import { Pin, RefreshCw } from "lucide-react";
import { Button } from "@thinkwork/ui";
import {
  CanvasBindingFreshnessQuery,
  PinArtifactMutation,
  RefreshCanvasDataMutation,
  SendMessageMutation,
} from "@/lib/graphql-queries";
import { SaveCanvasDialog } from "./SaveCanvasDialog";

interface RefreshBindingRow {
  bindingId: string;
  outcome?: string;
  viewerIsOwner?: boolean | null;
}

/**
 * Decide what to do after a headless refresh (THINK-167). Owner-dispatch only
 * when EVERY needs-user binding belongs to the viewer (a partial dispatch
 * would still leave someone else's widgets stale and toast success anyway)
 * and the canvas's thread is known. Exported for tests.
 */
export function ownerRefreshPlan(
  bindings: readonly RefreshBindingRow[],
  threadId: string | null,
):
  | { kind: "done" }
  | { kind: "ask_agent" }
  | { kind: "owner_dispatch"; staleBindingIds: string[] } {
  const needsUser = bindings.filter((b) => b.outcome === "NEEDS_USER");
  if (needsUser.length === 0) return { kind: "done" };
  const viewerOwnsAll = needsUser.every((b) => b.viewerIsOwner === true);
  if (!viewerOwnsAll || !threadId) return { kind: "ask_agent" };
  return {
    kind: "owner_dispatch",
    staleBindingIds: needsUser.map((b) => b.bindingId),
  };
}

/** How long the owner-dispatched refresh is polled before giving up (ms). */
const OWNER_REFRESH_POLL_TIMEOUT_MS = 180_000;
const OWNER_REFRESH_POLL_INTERVAL_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Header actions for a canvas artifact (THINK-145 declutter): muted icon
 * buttons in the page header instead of in-body chrome. Drafts get the Save
 * dialog; saved canvases get Refresh-data (when bindings exist) + Pin-version.
 *
 * Owner-initiated refresh (THINK-167): when the headless refresh reports
 * NEEDS_USER bindings that the VIEWER owns, dispatch an agent-mediated refresh
 * as the owner into the canvas's thread (`sendMessage` + `agentRequested` — a
 * thread turn, never a wakeup) and poll binding freshness until the agent's
 * in-turn re-run + re-emit lands (quality GOOD, U1). The "ask the agent" toast
 * remains only for viewers who are NOT the credential owner.
 */
export function CanvasHeaderActions({
  artifact,
  hasBindings,
  onChanged,
}: {
  artifact: {
    id: string;
    title: string;
    status: string;
    threadId?: string | null;
  };
  hasBindings: boolean;
  onChanged: () => void;
}) {
  const isDraft = artifact.status?.toLowerCase() === "draft";
  const client = useClient();
  const [{ fetching: pinning }, pinArtifact] = useMutation(PinArtifactMutation);
  const [, refreshCanvasData] = useMutation(RefreshCanvasDataMutation);
  const [, sendMessage] = useMutation(SendMessageMutation);
  const [refreshing, setRefreshing] = useState(false);

  const dispatchOwnerRefresh = useCallback(
    async (threadId: string, staleBindingIds: ReadonlySet<string>) => {
      const send = await sendMessage({
        input: {
          threadId,
          role: "USER",
          // The exact prompt shape proven end-to-end for the agent-mediated
          // refresh path (THINK-165 live verification): the refresh tool's
          // NEEDS_USER result instructs the in-turn re-run + same-id re-emit.
          content: `Open the "${artifact.title}" canvas and refresh its data.`,
          agentRequested: true,
        },
      });
      if (send.error) {
        toast.error(`Couldn't start refresh: ${send.error.message}`);
        return;
      }
      toast.info("Refreshing via your connection…");
      const deadline = Date.now() + OWNER_REFRESH_POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(OWNER_REFRESH_POLL_INTERVAL_MS);
        const res = await client
          .query(
            CanvasBindingFreshnessQuery,
            { id: artifact.id },
            { requestPolicy: "network-only" },
          )
          .toPromise();
        const bindings: Array<{ id: string; quality?: string }> =
          res.data?.artifact?.bindings ?? [];
        const pending = bindings.filter(
          (b) => staleBindingIds.has(b.id) && b.quality !== "GOOD",
        );
        if (bindings.length > 0 && pending.length === 0) {
          toast.success("Canvas data refreshed.");
          onChanged();
          return;
        }
      }
      toast.info(
        "Refresh is still running in the background — check back shortly.",
      );
    },
    [artifact.id, artifact.title, client, onChanged, sendMessage],
  );

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
        const plan = ownerRefreshPlan(
          (payload?.bindings ?? []) as RefreshBindingRow[],
          artifact.threadId ?? null,
        );
        if (plan.kind === "owner_dispatch") {
          await dispatchOwnerRefresh(
            artifact.threadId as string,
            new Set(plan.staleBindingIds),
          );
        } else if (plan.kind === "ask_agent") {
          toast.info("Ask the agent in a thread to refresh this canvas.");
        }
      }
    } finally {
      setRefreshing(false);
      onChanged();
    }
  }, [
    artifact.id,
    artifact.threadId,
    dispatchOwnerRefresh,
    onChanged,
    refreshCanvasData,
  ]);

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
