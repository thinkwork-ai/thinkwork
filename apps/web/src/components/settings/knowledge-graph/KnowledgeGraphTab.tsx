import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@thinkwork/ui";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { KnowledgeGraphExplorer } from "./KnowledgeGraphExplorer";

type ExplorerMode = "data" | "definitions";

/**
 * Ontology explorer as a tab of the unified Memory page. This is the explorer
 * half of the former standalone Knowledge Graph page. Company Brain plugin
 * detail owns the substrate lifecycle surface, so there is no config/Info
 * toggle here.
 */
export function KnowledgeGraphTab() {
  const [threadSheetOpen, setThreadSheetOpen] = useState(false);
  const [explorerMode, setExplorerMode] = useState<ExplorerMode>("data");

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <SettingsPageTitle
        title="Ontology"
        description="Inspect Cognee entities, relationships, diagnostics, and message evidence."
        actions={
          <ToggleGroup
            type="single"
            value={explorerMode}
            onValueChange={(value) =>
              value && setExplorerMode(value as ExplorerMode)
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
        }
      />
      <div className="min-h-0 flex-1">
        <KnowledgeGraphExplorer
          mode={explorerMode}
          threadSheetOpen={threadSheetOpen}
          onThreadSheetOpenChange={setThreadSheetOpen}
        />
      </div>
    </div>
  );
}
