import { useCallback, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Eye, EyeOff, Inbox, Plus, RefreshCw } from "lucide-react";
import { TooltipIconButton, cn } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  SettingsMemory,
  type MemoryRawUnitsController,
  type MemoryRefreshController,
} from "@/components/settings/SettingsMemory";
import { SettingsKnowledgeBases } from "@/components/settings/SettingsKnowledgeBases";
import { KnowledgeModelTab } from "@/components/settings/knowledge-model/KnowledgeModelTab";
import type { OntologyMapHeaderController } from "@/components/settings/knowledge-model/OntologyMapView";
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
 * The unified Memory settings page. Memory records, KBs, and the knowledge
 * Ontology tab are siblings rendered in the AppTopBar and driven by the route
 * so each tab is deep-linkable. The Ontology tab keeps its historical
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
  const [ontologyMapController, setOntologyMapController] =
    useState<OntologyMapHeaderController | null>(null);

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
  const updateOntologyMapController = useCallback(
    (controller: OntologyMapHeaderController | null) => {
      setOntologyMapController(controller);
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

  // Living Map header actions (sibling-UX parity): icon-only ghost buttons
  // with hover tooltips at the far right of the page header — the same
  // TooltipIconButton row the Agents page header uses — driven by the
  // controller the map publishes while mounted.
  const ontologyAction =
    activeTab === "ontology" && ontologyMapController ? (
      <div className="flex items-center gap-1">
        <TooltipIconButton
          label="Add triple"
          onClick={() => ontologyMapController.openAddTriple()}
        >
          <Plus className="size-4" />
        </TooltipIconButton>
        <TooltipIconButton
          label="Review queue"
          className="relative"
          aria-label={`Review queue (${ontologyMapController.pendingCount} pending)`}
          onClick={() => ontologyMapController.openQueue()}
        >
          <Inbox className="size-4" />
          {ontologyMapController.pendingCount > 0 ? (
            <span
              aria-hidden
              className="bg-primary text-primary-foreground absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium leading-none"
            >
              {ontologyMapController.pendingCount}
            </span>
          ) : null}
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
      { to: ONTOLOGY, label: "Ontology" },
    ],
    action: activeTab === "ontology" ? ontologyAction : refreshAction,
    actionKey: `memory-refresh:${activeTab}:${refreshDisabled ? "disabled" : "enabled"}:${refreshing ? "refreshing" : "idle"}:${rawUnitsController ? `${rawUnitsController.showRaw ? "raw" : "curated"}:${rawUnitsController.hiddenCount}` : "no-raw"}:${ontologyMapController ? `ontology:${ontologyMapController.pendingCount}` : "no-ontology"}`,
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
      {activeTab === "ontology" ? (
        <KnowledgeModelTab
          onMapHeaderControllerChange={updateOntologyMapController}
        />
      ) : null}
    </div>
  );
}
