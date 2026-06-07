import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { SettingsMemory } from "@/components/settings/SettingsMemory";
import { SettingsKnowledgeBases } from "@/components/settings/SettingsKnowledgeBases";
import { SettingsWiki } from "@/components/settings/SettingsWiki";

type MemoryTab = "memory" | "knowledge-bases" | "wiki";

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
      </Tabs>
    </div>
  );
}
