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
import { SettingsKnowledgeBases } from "@/components/settings/SettingsKnowledgeBases";
import { KnowledgeModelTab } from "@/components/settings/knowledge-model/KnowledgeModelTab";
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
 * The unified Memory settings page. Memory records, KBs, and the Knowledge
 * Model are sibling tabs rendered in the AppTopBar and driven by the route so
 * each tab is deep-linkable. The Knowledge Model tab keeps its historical
 * /settings/memory/ontology path so existing links keep working.
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
    title: "Memory",
    breadcrumbs: [{ label: "Memory" }],
    tabs: [
      { to: MEMORY, label: "Memory" },
      { to: WIKI, label: "Wiki" },
      { to: KNOWLEDGE_BASES, label: "KBs" },
      { to: ONTOLOGY, label: "Knowledge Model" },
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
      {activeTab === "ontology" ? <KnowledgeModelTab /> : null}
    </div>
  );
}
