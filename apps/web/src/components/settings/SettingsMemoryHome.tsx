import { useState } from "react";
import { useQuery } from "urql";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { SettingsDeploymentStatusQuery } from "@/lib/settings-queries";
import { SettingsMemory } from "@/components/settings/SettingsMemory";
import { SettingsKnowledgeBases } from "@/components/settings/SettingsKnowledgeBases";
import { SettingsWiki } from "@/components/settings/SettingsWiki";
import { KnowledgeGraphTab } from "@/components/settings/knowledge-graph/KnowledgeGraphTab";

type MemoryTab = "memory" | "knowledge-bases" | "wiki" | "knowledge-graph";

/**
 * The unified Memory settings page. Memory, Knowledge Bases, and Wiki (and, in
 * a follow-up unit, the Knowledge Graph explorer) are rendered as tabs of a
 * single page. This container owns the page header ("Memory"); each embedded
 * facet suppresses its own header so the breadcrumb stays stable across tab
 * switches. Tab selection is local state — old routes redirect here.
 */
export function SettingsMemoryHome() {
  const [tab, setTab] = useState<MemoryTab>("memory");
  usePageHeaderActions({ title: "Memory", breadcrumbs: [{ label: "Memory" }] });

  // The Knowledge Graph tab only applies when Cognee is running for this
  // deployment — mirrors the old standalone route's `managedAppKey` gating.
  const [deploymentResult] = useQuery({ query: SettingsDeploymentStatusQuery });
  const deployment = deploymentResult.data?.deploymentStatus;
  const cogneeEnabled =
    deployment?.managedApplications.find((app) => app.key === "cognee")
      ?.runtimeEnabled ??
    deployment?.cogneeEnabled ??
    false;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as MemoryTab)}
        className="flex h-full min-h-0 flex-col"
      >
        <TabsList
          variant="line"
          className="w-full shrink-0 justify-start border-b px-6 pt-4"
        >
          <TabsTrigger value="memory" className="flex-none px-3">
            Memory
          </TabsTrigger>
          <TabsTrigger value="knowledge-bases" className="flex-none px-3">
            Knowledge Bases
          </TabsTrigger>
          <TabsTrigger value="wiki" className="flex-none px-3">
            Wiki
          </TabsTrigger>
          {cogneeEnabled ? (
            <TabsTrigger value="knowledge-graph" className="flex-none px-3">
              Knowledge Graph
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="memory" className="min-h-0 flex-1 overflow-hidden">
          <SettingsMemory embedded />
        </TabsContent>
        <TabsContent
          value="knowledge-bases"
          className="min-h-0 flex-1 overflow-hidden"
        >
          <SettingsKnowledgeBases embedded />
        </TabsContent>
        <TabsContent value="wiki" className="min-h-0 flex-1 overflow-hidden">
          <SettingsWiki embedded />
        </TabsContent>
        {cogneeEnabled ? (
          <TabsContent
            value="knowledge-graph"
            className="min-h-0 flex-1 overflow-hidden"
          >
            <KnowledgeGraphTab />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
