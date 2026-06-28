import { useLocation } from "@tanstack/react-router";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { SettingsMemory } from "@/components/settings/SettingsMemory";
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

  usePageHeaderActions({
    title: "Memory",
    breadcrumbs: [{ label: "Memory" }],
    tabs: [
      { to: MEMORY, label: "Memory" },
      { to: KNOWLEDGE_BASES, label: "KBs" },
      { to: ONTOLOGY, label: "Ontology" },
    ],
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {activeTab === "memory" ? <SettingsMemory embedded /> : null}
      {activeTab === "knowledge-bases" ? (
        <SettingsKnowledgeBases embedded />
      ) : null}
      {activeTab === "ontology" ? <KnowledgeGraphTab /> : null}
    </div>
  );
}
