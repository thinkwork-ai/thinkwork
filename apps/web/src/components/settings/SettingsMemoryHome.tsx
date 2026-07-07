import { useCallback, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  SettingsMemory,
  type MemoryRawUnitsController,
  type MemoryRefreshController,
} from "@/components/settings/SettingsMemory";
import { SettingsKnowledgeBases } from "@/components/settings/SettingsKnowledgeBases";
import { KnowledgeGraphTab } from "@/components/settings/knowledge-graph/KnowledgeGraphTab";
import { SettingsWiki } from "@/components/settings/SettingsWiki";

const MEMORY = "/settings/memory";
const WIKI = "/settings/memory/wiki";
const KNOWLEDGE_BASES = "/settings/memory/knowledge-bases";
const ONTOLOGY = "/settings/memory/ontology";

type MemoryTab = "memory" | "wiki" | "knowledge-bases" | "ontology";

function tabForPath(pathname: string): MemoryTab {
  if (pathname.startsWith(WIKI)) return "wiki";
  if (pathname.startsWith(KNOWLEDGE_BASES)) return "knowledge-bases";
  if (pathname.startsWith(ONTOLOGY)) return "ontology";
  return "memory";
}

/**
 * The unified Memory settings page. Memory records, KBs, and Ontology are
 * sibling tabs rendered in the AppTopBar and driven by the route so each tab is
 * deep-linkable.
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary",
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
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-64 border border-border bg-popover text-popover-foreground shadow-md"
              arrowClassName="bg-popover fill-popover border-b border-r border-border"
            >
              {rawUnitsController.showRaw
                ? "Showing all memory units. Click to return to the curated view (consolidated observations, corroborated facts, and deliberate captures)."
                : `Curated view — ${rawUnitsController.hiddenCount} raw uncorroborated unit${rawUnitsController.hiddenCount === 1 ? "" : "s"} hidden. Click to show everything.`}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            "text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary",
            refreshing && "bg-primary/10 text-primary hover:text-primary",
          )}
          aria-label="Refresh memory records"
          title="Refresh memory records"
          disabled={refreshDisabled}
          onClick={() => void refreshMemory()}
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </Button>
      </div>
    ) : null;

  usePageHeaderActions({
    title: "Memory",
    breadcrumbs: [{ label: "Memory" }],
    tabs: [
      { to: MEMORY, label: "Memory" },
      { to: WIKI, label: "Wiki" },
      { to: KNOWLEDGE_BASES, label: "KBs" },
      { to: ONTOLOGY, label: "Ontology" },
    ],
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
      {activeTab === "wiki" ? <SettingsWiki embedded /> : null}
      {activeTab === "knowledge-bases" ? (
        <SettingsKnowledgeBases embedded />
      ) : null}
      {activeTab === "ontology" ? <KnowledgeGraphTab /> : null}
    </div>
  );
}
