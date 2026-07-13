import { KnowledgeGraphExplorer } from "./KnowledgeGraphExplorer";

/**
 * Term definitions as content of the Model tab's Definitions sub-view. This
 * intentionally shows definitions only; the old data/graph explorer is not
 * part of the active memory path. The title row is owned by KnowledgeModelTab.
 */
export function KnowledgeGraphTab() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="min-h-0 flex-1">
        <KnowledgeGraphExplorer mode="definitions" />
      </div>
    </div>
  );
}
