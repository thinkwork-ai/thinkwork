import { useState } from "react";
import { Button } from "@thinkwork/ui";
import { Info, Network } from "lucide-react";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { KnowledgeGraphConfigPanel } from "./knowledge-graph/KnowledgeGraphConfigPanel";
import { KnowledgeGraphExplorer } from "./knowledge-graph/KnowledgeGraphExplorer";

export function SettingsKnowledgeGraph() {
  const [showConfig, setShowConfig] = useState(false);

  usePageHeaderActions({
    title: "Knowledge Graph",
    breadcrumbs: [{ label: "Knowledge Graph" }],
    action: (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={
          showConfig
            ? "Show Knowledge Graph Explorer"
            : "Show Knowledge Graph configuration"
        }
        onClick={() => setShowConfig((value) => !value)}
      >
        {showConfig ? (
          <Network className="size-4" />
        ) : (
          <Info className="size-4" />
        )}
      </Button>
    ),
    actionKey: `knowledge-graph:${showConfig ? "config" : "explorer"}`,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <SettingsPageTitle
        title="Knowledge Graph"
        description={
          showConfig
            ? "Cognee infrastructure for ontology and graph retrieval."
            : "Inspect Cognee entities, relationships, diagnostics, and message evidence."
        }
      />
      <div className="min-h-0 flex-1">
        {showConfig ? (
          <KnowledgeGraphConfigPanel />
        ) : (
          <KnowledgeGraphExplorer />
        )}
      </div>
    </div>
  );
}
