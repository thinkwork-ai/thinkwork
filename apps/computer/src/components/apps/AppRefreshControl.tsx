import { useMemo, useState } from "react";
import {
  RefreshBar,
  type AppletRefreshResult,
} from "@thinkwork/computer-stdlib";

type AppRefreshState =
  | "available"
  | "running"
  | "succeeded"
  | "partial"
  | "failed";

export function AppRefreshControl({
  onRefresh,
  onData,
}: {
  onRefresh: () => Promise<AppletRefreshResult>;
  onData?: (data: unknown) => void;
}) {
  const [refreshState, setRefreshState] =
    useState<AppRefreshState>("available");
  const [sourceStatuses, setSourceStatuses] = useState<
    AppletRefreshResult["sourceStatuses"] | undefined
  >();
  const [error, setError] = useState<string | null>(null);
  const warning = useMemo(
    () => partialWarning(sourceStatuses, refreshState),
    [refreshState, sourceStatuses],
  );

  async function handleRefresh() {
    setRefreshState("running");
    setError(null);
    try {
      const result = await onRefresh();
      setSourceStatuses(result.sourceStatuses);
      const nextState = refreshStateFromStatuses(result.sourceStatuses);
      if (nextState === "failed" || result.data == null) {
        setRefreshState("failed");
        setError(refreshErrorMessage(result));
        return;
      }
      onData?.(result.data);
      setRefreshState(nextState);
    } catch (err) {
      setSourceStatuses({ refresh: "failed" });
      setRefreshState("failed");
      setError(err instanceof Error ? err.message : "Refresh failed.");
    }
  }

  return (
    <RefreshBar
      title="Refresh app"
      description="Refresh runs this app's saved deterministic update function. It does not ask Computer to reinterpret the request."
      refreshState={refreshState}
      sourceStatuses={sourceStatuses}
      error={error ?? warning}
      onRefresh={handleRefresh}
    />
  );
}

function refreshStateFromStatuses(
  statuses: AppletRefreshResult["sourceStatuses"],
): AppRefreshState {
  const values = Object.values(statuses);
  if (!values.length) return "succeeded";
  if (values.every((status) => status === "failed")) return "failed";
  if (values.some((status) => status !== "success")) return "partial";
  return "succeeded";
}

function refreshErrorMessage(result: AppletRefreshResult) {
  const firstError = result.errors?.[0]?.message;
  return firstError || "Refresh failed; showing the prior app data.";
}

function partialWarning(
  statuses: AppletRefreshResult["sourceStatuses"] | undefined,
  refreshState: AppRefreshState,
) {
  if (refreshState !== "partial" || !statuses) return null;
  const degraded = Object.entries(statuses)
    .filter(([, status]) => status !== "success")
    .map(([source]) => source);
  if (!degraded.length) return null;
  return `Partial refresh: ${degraded.join(", ")} did not fully update.`;
}
