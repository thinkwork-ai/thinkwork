import { useCallback, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { Button, cn } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  SettingsMemory,
  type MemoryRefreshController,
} from "@/components/settings/SettingsMemory";
import { SettingsKnowledgeBases } from "@/components/settings/SettingsKnowledgeBases";
import { KnowledgeGraphTab } from "@/components/settings/knowledge-graph/KnowledgeGraphTab";

const MEMORY = "/settings/memory";
const KNOWLEDGE_BASES = "/settings/memory/knowledge-bases";
const ONTOLOGY = "/settings/memory/ontology";

type MemoryTab = "memory" | "knowledge-bases" | "ontology";

function tabForPath(pathname: string): MemoryTab {
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

  const updateRefreshController = useCallback(
    (controller: MemoryRefreshController | null) => {
      setRefreshController(controller);
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
    ) : null;

  usePageHeaderActions({
    title: "Memory",
    breadcrumbs: [{ label: "Memory" }],
    tabs: [
      { to: MEMORY, label: "Memory" },
      { to: KNOWLEDGE_BASES, label: "KBs" },
      { to: ONTOLOGY, label: "Ontology" },
    ],
    action: refreshAction,
    actionKey: `memory-refresh:${activeTab}:${refreshDisabled ? "disabled" : "enabled"}:${refreshing ? "refreshing" : "idle"}`,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {activeTab === "memory" ? (
        <SettingsMemory
          embedded
          onRefreshControllerChange={updateRefreshController}
        />
      ) : null}
      {activeTab === "knowledge-bases" ? (
        <SettingsKnowledgeBases embedded />
      ) : null}
      {activeTab === "ontology" ? <KnowledgeGraphTab /> : null}
    </div>
  );
}
