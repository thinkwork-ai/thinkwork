import { useLocation } from "@tanstack/react-router";
import { useQuery } from "urql";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import {
  SettingsDeploymentStatusQuery,
  SettingsPluginCatalogQuery,
} from "@/lib/settings-queries";
import { SettingsMemory } from "@/components/settings/SettingsMemory";
import { SettingsKnowledgeBases } from "@/components/settings/SettingsKnowledgeBases";
import { SettingsWiki } from "@/components/settings/SettingsWiki";
import { KnowledgeGraphTab } from "@/components/settings/knowledge-graph/KnowledgeGraphTab";

const MEMORY = "/settings/memory";
const KNOWLEDGE_BASES = "/settings/memory/knowledge-bases";
const WIKI = "/settings/memory/wiki";
const KNOWLEDGE_GRAPH = "/settings/memory/knowledge-graph";

type MemoryTab = "memory" | "knowledge-bases" | "wiki" | "knowledge-graph";

function tabForPath(pathname: string): MemoryTab {
  if (pathname.startsWith(KNOWLEDGE_BASES)) return "knowledge-bases";
  if (pathname.startsWith(WIKI)) return "wiki";
  if (pathname.startsWith(KNOWLEDGE_GRAPH)) return "knowledge-graph";
  return "memory";
}

/**
 * The unified Memory settings page. Memory, Knowledge Bases, Wiki, and (when
 * ThinkWork Brain's substrate is available) the Knowledge Graph explorer are
 * sibling tabs rendered in the AppTopBar — driven by the route so each tab is
 * deep-linkable. This page owns the page header and renders the active facet's
 * body; each embedded facet suppresses its own header so the "Memory"
 * breadcrumb stays stable.
 */
export function SettingsMemoryHome() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const activeTab = tabForPath(pathname);

  const [deploymentResult] = useQuery({ query: SettingsDeploymentStatusQuery });
  const [catalogResult] = useQuery({ query: SettingsPluginCatalogQuery });
  const deployment = deploymentResult.data?.deploymentStatus;
  const companyBrainInstall = catalogResult.data?.pluginCatalog.find(
    (entry) => entry.pluginKey === "company-brain",
  )?.install;
  const companyBrainSubstrateReady = Boolean(
    companyBrainInstall?.state === "installed" ||
    companyBrainInstall?.components.some(
      (component) =>
        component.componentKey === "brain-substrate" &&
        component.state === "provisioned",
    ),
  );
  const legacyCogneeEnabled =
    deployment?.managedApplications.find((app) => app.key === "cognee")
      ?.runtimeEnabled ??
    deployment?.cogneeEnabled ??
    false;
  const ontologyEnabled = companyBrainSubstrateReady || legacyCogneeEnabled;

  usePageHeaderActions({
    title: "Memory",
    breadcrumbs: [{ label: "Memory" }],
    tabs: [
      { to: MEMORY, label: "Memory" },
      { to: KNOWLEDGE_BASES, label: "KBs" },
      ...(ontologyEnabled ? [{ to: KNOWLEDGE_GRAPH, label: "Graph" }] : []),
      { to: WIKI, label: "Wiki" },
    ],
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {activeTab === "memory" ? <SettingsMemory embedded /> : null}
      {activeTab === "knowledge-bases" ? (
        <SettingsKnowledgeBases embedded />
      ) : null}
      {activeTab === "wiki" ? <SettingsWiki embedded /> : null}
      {activeTab === "knowledge-graph" ? <KnowledgeGraphTab /> : null}
    </div>
  );
}
