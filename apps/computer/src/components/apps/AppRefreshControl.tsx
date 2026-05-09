import { useMemo, useState } from "react";
import { Ellipsis, Loader2, RefreshCw } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@thinkwork/ui";
import type { AppletRefreshResult } from "@thinkwork/computer-stdlib";

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
  const isRefreshing = refreshState === "running";
  const statusText = refreshStatusText(refreshState, error ?? warning);

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Artifact actions"
          title="Artifact actions"
          className="text-muted-foreground"
        >
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {statusText}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isRefreshing} onClick={handleRefresh}>
          {isRefreshing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function refreshStatusText(state: AppRefreshState, message: string | null) {
  if (message) return message;
  switch (state) {
    case "running":
      return "Refreshing...";
    case "succeeded":
      return "Refresh completed.";
    case "partial":
      return "Refresh partially completed.";
    case "failed":
      return "Refresh failed.";
    default:
      return "Refresh available.";
  }
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
