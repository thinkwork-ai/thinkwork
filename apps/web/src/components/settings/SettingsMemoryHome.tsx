import { useCallback, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  SettingsMemory,
  type MemoryRefreshController,
} from "@/components/settings/SettingsMemory";
import { SettingsKnowledgeBases } from "@/components/settings/SettingsKnowledgeBases";
import { KnowledgeGraphTab } from "@/components/settings/knowledge-graph/KnowledgeGraphTab";

const MEMORY = "/settings/memory";
const KNOWLEDGE_BASES = "/settings/memory/knowledge-bases";
const ONTOLOGY = "/settings/memory/knowledge-graph";

type MemoryTab = "memory" | "knowledge-bases" | "ontology";

function tabForPath(pathname: string): MemoryTab {
  if (pathname.startsWith(KNOWLEDGE_BASES)) return "knowledge-bases";
  if (pathname.startsWith(ONTOLOGY)) return "ontology";
  return "memory";
}

/**
 * The unified Memory settings page. Memory, KBs, and Ontology are sibling
 * tabs rendered in the AppTopBar — driven by the route so each tab is
 * deep-linkable.
 */
export function SettingsMemoryHome() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeTab = tabForPath(pathname);
  const [refreshController, setRefreshController] =
    useState<MemoryRefreshController | null>(null);

  const updateRefreshController = useCallback(
    (controller: MemoryRefreshController | null) => {
      setRefreshController(controller);
    },
    [],
  );

  const refreshAction =
    activeTab === "memory" ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-foreground"
        aria-label="Refresh memory records"
        title="Refresh memory records"
        disabled={refreshController?.disabled ?? true}
        onClick={() => {
          void refreshController?.refresh();
        }}
      >
        <RefreshCw
          className={`size-4 ${refreshController?.isRefreshing ? "animate-spin" : ""}`}
        />
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
    actionKey: `memory-refresh:${activeTab}:${refreshController?.disabled ? "disabled" : "enabled"}:${refreshController?.isRefreshing ? "refreshing" : "idle"}`,
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
