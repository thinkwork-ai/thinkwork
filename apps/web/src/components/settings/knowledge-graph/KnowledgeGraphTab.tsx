import { useState } from "react";
import { IconMessages } from "@tabler/icons-react";
import { Button, ToggleGroup, ToggleGroupItem } from "@thinkwork/ui";
import { SettingsPageTitle } from "@/components/settings/SettingsContent";
import { KnowledgeGraphExplorer } from "./KnowledgeGraphExplorer";

type ExplorerMode = "data" | "definitions";

/**
 * Knowledge Graph explorer as a tab of the unified Memory page. This is the
 * explorer half of the former standalone Knowledge Graph page — the deployment
 * config half now lives on the Cognee Application page (Applications > Cognee),
 * so there is no config/Info toggle here.
 */
export function KnowledgeGraphTab() {
  const [threadSheetOpen, setThreadSheetOpen] = useState(false);
  const [explorerMode, setExplorerMode] = useState<ExplorerMode>("data");

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <SettingsPageTitle
        title="Knowledge Graph"
        description="Inspect Cognee entities, relationships, diagnostics, and message evidence."
        actions={
          <div className="flex items-center gap-1">
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
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Open thread ingest"
              onClick={() => setThreadSheetOpen((value) => !value)}
            >
              <IconMessages className="size-4" />
            </Button>
          </div>
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
