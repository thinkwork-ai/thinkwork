import { useCallback, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { TooltipIconButton, cn } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  SettingsMemory,
  type MemoryRawUnitsController,
  type MemoryRefreshController,
} from "@/components/settings/SettingsMemory";

const RECORDS = "/settings/memory/records";

type MemoryTab = "memory";

function tabForPath(pathname: string): MemoryTab {
  // THINK-339 U15: the Company Brain and Ontology tabs moved to the
  // standalone console (brain.thinkwork.ai) — Memory records are the
  // landing tab again; the bare /settings/memory path renders them.
  return "memory";
}

/**
 * The unified Memory settings page. The Company Brain and Ontology tabs
 * retired to the standalone console (THINK-339 U15).
 */
export function SettingsMemoryHome() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeTab = tabForPath(pathname);
  const [refreshController, setRefreshController] =
    useState<MemoryRefreshController | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [rawUnitsController, setRawUnitsController] =
    useState<MemoryRawUnitsController | null>(null);

  const updateRefreshController = useCallback(
    (controller: MemoryRefreshController | null) => {
      setRefreshController(controller);
    },
    [],
  );
  const updateRawUnitsController = useCallback(
    (controller: MemoryRawUnitsController | null) => {
      setRawUnitsController(controller);
    },
    [],
  );

  const refreshing =
    refreshPending || (refreshController?.isRefreshing ?? false);
  const refreshDisabled = refreshController?.disabled ?? true;
  const refreshMemory = useCallback(async () => {
    if (!refreshController || refreshDisabled || refreshPending) return;
    setRefreshPending(true);
    try {
      await Promise.all([
        refreshController.refresh(),
        new Promise((resolve) => window.setTimeout(resolve, 450)),
      ]);
    } finally {
      setRefreshPending(false);
    }
  }, [refreshController, refreshDisabled, refreshPending]);

  const refreshAction =
    activeTab === "memory" ? (
      <div className="flex items-center gap-1">
        {rawUnitsController ? (
          <TooltipIconButton
            label={
              rawUnitsController.showRaw
                ? "Showing all memory units. Click to return to the curated view (consolidated observations, corroborated facts, and deliberate captures)."
                : `Curated view — ${rawUnitsController.hiddenCount} raw uncorroborated unit${rawUnitsController.hiddenCount === 1 ? "" : "s"} hidden. Click to show everything.`
            }
            className={cn(
              rawUnitsController.showRaw &&
                "bg-primary/10 text-primary hover:text-primary",
            )}
            aria-label={
              rawUnitsController.showRaw
                ? "Hide raw memory units"
                : "Show raw memory units"
            }
            data-testid="settings-memory-toggle-raw"
            onClick={() => rawUnitsController.toggle()}
          >
            {rawUnitsController.showRaw ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </TooltipIconButton>
        ) : null}
        <TooltipIconButton
          label="Refresh memory records"
          className={cn(
            refreshing && "bg-primary/10 text-primary hover:text-primary",
          )}
          disabled={refreshDisabled}
          onClick={() => void refreshMemory()}
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </TooltipIconButton>
      </div>
    ) : null;

  usePageHeaderActions({
    // "Knowledge" umbrella naming (Company Brain U9): the nav item and this
    // page title read Knowledge. URLs unchanged.
    title: "Knowledge",
    breadcrumbs: [{ label: "Knowledge" }],
    tabs: [{ to: RECORDS, label: "Memory", active: activeTab === "memory" }],
    action: refreshAction,
    actionKey: `memory-refresh:${activeTab}:${refreshDisabled ? "disabled" : "enabled"}:${refreshing ? "refreshing" : "idle"}:${rawUnitsController ? `${rawUnitsController.showRaw ? "raw" : "curated"}:${rawUnitsController.hiddenCount}` : "no-raw"}`,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {activeTab === "memory" ? (
        <SettingsMemory
          embedded
          onRefreshControllerChange={updateRefreshController}
          onRawUnitsControllerChange={updateRawUnitsController}
        />
      ) : null}
    </div>
  );
}
