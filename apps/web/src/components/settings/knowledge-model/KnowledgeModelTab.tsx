import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@thinkwork/ui";
import { KnowledgeGraphTab } from "@/components/settings/knowledge-graph/KnowledgeGraphTab";
import { IdentityList } from "./IdentityList";
import { ResolutionQueue } from "./ResolutionQueue";

type KnowledgeModelView = "definitions" | "identity" | "resolution-queue";

/**
 * Knowledge Model tab of the unified Memory page (THINK-193 U4). Hosts three
 * sub-views: ontology term Definitions (the pre-existing knowledge-graph tab
 * content), the canonical-entity Identity list, and the entity Resolution
 * Queue. Sub-view selection is component-local state so the existing
 * /settings/memory/ontology route keeps working unchanged.
 */
export function KnowledgeModelTab() {
  const [view, setView] = useState<KnowledgeModelView>("definitions");

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex items-center px-6 pt-4">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) =>
            value && setView(value as KnowledgeModelView)
          }
          variant="outline"
          aria-label="Knowledge model view"
        >
          <ToggleGroupItem value="definitions" className="px-3 text-xs">
            Definitions
          </ToggleGroupItem>
          <ToggleGroupItem value="identity" className="px-3 text-xs">
            Identity
          </ToggleGroupItem>
          <ToggleGroupItem value="resolution-queue" className="px-3 text-xs">
            Resolution Queue
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="min-h-0 flex-1">
        {view === "definitions" ? <KnowledgeGraphTab /> : null}
        {view === "identity" ? <IdentityList /> : null}
        {view === "resolution-queue" ? <ResolutionQueue /> : null}
      </div>
    </div>
  );
}
