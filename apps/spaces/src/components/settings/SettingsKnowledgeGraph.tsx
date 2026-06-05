import { useState } from "react";
import { IconMessages } from "@tabler/icons-react";
import { Button, ToggleGroup, ToggleGroupItem } from "@thinkwork/ui";
import { Info, Network } from "lucide-react";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { KnowledgeGraphConfigPanel } from "./knowledge-graph/KnowledgeGraphConfigPanel";
import { KnowledgeGraphExplorer } from "./knowledge-graph/KnowledgeGraphExplorer";

export function SettingsKnowledgeGraph() {
  const [showConfig, setShowConfig] = useState(false);
  const [threadSheetOpen, setThreadSheetOpen] = useState(false);
  const [explorerMode, setExplorerMode] = useState<"data" | "definitions">(
    "data",
  );

  usePageHeaderActions({
    title: "Knowledge Graph",
    breadcrumbs: [{ label: "Knowledge Graph" }],
    action: (
      <div className="flex items-center gap-1">
        {!showConfig ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Open thread ingest"
            onClick={() => setThreadSheetOpen((value) => !value)}
          >
            <IconMessages className="size-4" />
          </Button>
        ) : null}
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
      </div>
    ),
    actionKey: `knowledge-graph:${showConfig ? "config" : "explorer"}:${threadSheetOpen}`,
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
        actions={
          showConfig ? null : (
            <ToggleGroup
              type="single"
              value={explorerMode}
              onValueChange={(value) =>
                value && setExplorerMode(value as "data" | "definitions")
              }
              variant="outline"
            >
              <ToggleGroupItem value="data" className="px-3 text-xs">
                Data
              </ToggleGroupItem>
              <ToggleGroupItem value="definitions" className="px-3 text-xs">
                Definitions
              </ToggleGroupItem>
            </ToggleGroup>
          )
        }
      />
      <div className="min-h-0 flex-1">
        {showConfig ? (
          <KnowledgeGraphConfigPanel />
        ) : (
          <KnowledgeGraphExplorer
            mode={explorerMode}
            threadSheetOpen={threadSheetOpen}
            onThreadSheetOpenChange={setThreadSheetOpen}
          />
        )}
      </div>
    </div>
  );
}
